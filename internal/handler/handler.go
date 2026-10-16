// Package handler contains the HTTP request handlers for the API.
package handler

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"blockads-filtering/internal/compiler"
	"blockads-filtering/internal/config"
	"blockads-filtering/internal/model"
	"blockads-filtering/internal/notifier"
	"blockads-filtering/internal/storage"
	"blockads-filtering/internal/store"

	"github.com/gin-gonic/gin"
)

// BuildHandler processes filter list build requests.
type BuildHandler struct {
	db       *store.Postgres
	r2       *storage.R2Client
	cfg      *config.Config
	notifier *notifier.Notifier
}

// NewBuildHandler creates a new BuildHandler with all dependencies injected.
func NewBuildHandler(db *store.Postgres, r2 *storage.R2Client, cfg *config.Config, notif *notifier.Notifier) *BuildHandler {
	return &BuildHandler{db: db, r2: r2, cfg: cfg, notifier: notif}
}

// TokenAuthMiddleware returns a Gin middleware that validates Authorization: Bearer <token>.
func TokenAuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.AdminToken == "" {
			c.JSON(http.StatusForbidden, model.ErrorResponse{
				Status:  "error",
				Message: "Admin token is not configured on the server",
			})
			c.Abort()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, model.ErrorResponse{
				Status:  "error",
				Message: "Authorization header is required",
			})
			c.Abort()
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader {
			// No "Bearer " prefix found
			c.JSON(http.StatusUnauthorized, model.ErrorResponse{
				Status:  "error",
				Message: "Authorization header must use Bearer scheme",
			})
			c.Abort()
			return
		}

		// Constant-time comparison to prevent timing attacks
		if subtle.ConstantTimeCompare([]byte(token), []byte(cfg.AdminToken)) != 1 {
			c.JSON(http.StatusUnauthorized, model.ErrorResponse{
				Status:  "error",
				Message: "Invalid admin token",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// Build handles POST /api/build
//
// Request Body:
//
//	{"url": "https://example.com/filter.txt"}
//	OR
//	{"urls": ["https://example.com/filter1.txt", "https://example.com/filter2.txt"], "name": "my_combined"}
//
// Name is auto-derived from the URL(s) if not specified.
//
// Response:
//
//	{"status": "success", "downloadUrl": "https://pub-xyz.r2.dev/MyFilter.zip"}
func (h *BuildHandler) Build(c *gin.Context) {
	// ── Parse & validate request ──
	var req model.BuildRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Invalid request body: " + err.Error(),
		})
		return
	}

	urls := req.URLs
	if len(urls) == 0 && req.URL != "" {
		urls = []string{req.URL}
	}

	var cleanURLs []string
	for _, u := range urls {
		u = strings.TrimSpace(u)
		if u != "" {
			cleanURLs = append(cleanURLs, u)
		}
	}

	if len(cleanURLs) == 0 {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "No filter list URL(s) provided",
		})
		return
	}

	var compositeURL string
	if len(cleanURLs) == 1 {
		compositeURL = cleanURLs[0]
	} else {
		compositeURL = strings.Join(cleanURLs, ",")
	}

	// ── Check if URL already exists in the database ──
	// Skip re-compilation unless ?force=true is set
	forceRebuild := strings.EqualFold(c.Query("force"), "true")
	if !forceRebuild {
		existing, err := h.db.GetFilterByURL(c.Request.Context(), compositeURL)
		if err == nil && existing != nil {
			log.Printf("[API] URL already exists in DB: %s (id=%d), returning existing record", compositeURL, existing.ID)
			c.JSON(http.StatusOK, model.BuildResponse{
				Status:      "success",
				DownloadURL: existing.R2DownloadLink,
				RuleCount:   existing.RuleCount,
				FileSize:    existing.FileSize,
			})
			return
		}
	}

	// Derive name from URL(s) or custom provided name
	var name string
	if req.Name != "" {
		name = sanitizeName(req.Name)
	} else if len(cleanURLs) == 1 {
		name = deriveNameFromURL(cleanURLs[0])
		name = sanitizeName(name)
	} else {
		hasher := sha256.New()
		for _, u := range cleanURLs {
			hasher.Write([]byte(u))
		}
		hashStr := hex.EncodeToString(hasher.Sum(nil))[:8]
		baseName := sanitizeName(deriveNameFromURL(cleanURLs[0]))
		name = fmt.Sprintf("merged_%s_%s", baseName, hashStr)
	}

	if name == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Could not derive a valid name from the provided URL(s)",
		})
		return
	}

	// ── Validate all URLs are reachable ──
	for _, u := range cleanURLs {
		log.Printf("[API] Validating URL: %s", u)
		if err := compiler.ValidateFilterListURL(u); err != nil {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{
				Status:  "error",
				Message: fmt.Sprintf("URL validation failed for %s: %s", u, err.Error()),
			})
			return
		}
	}

	// ── Compile the filter list(s) ──
	log.Printf("[API] Starting compilation for '%s' (%d URL(s))", name, len(cleanURLs))
	result, err := compiler.CompileMultipleFilterLists(name, cleanURLs)
	if err != nil {
		if errors.Is(err, compiler.ErrNoRulesFound) {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{
				Status:  "error",
				Message: "Compilation failed: " + err.Error(),
			})
			return
		}
		if h.notifier != nil {
			h.notifier.NotifyBuildFailure(compositeURL, "Compilation failed: "+err.Error())
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "Compilation failed: " + err.Error(),
		})
		return
	}

	// ── Upload to Cloudflare R2 ──
	log.Printf("[API] Uploading %s.zip to R2 (%s)", name, formatBytes(result.FileSize))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	downloadURL, err := h.r2.UploadZip(ctx, name, result.ZipData)
	if err != nil {
		if h.notifier != nil {
			h.notifier.NotifyBuildFailure(compositeURL, "R2 upload failed: "+err.Error())
		}
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "R2 upload failed: " + err.Error(),
		})
		return
	}

	// Cache-buster query to prevent CDN from serving old versions
	downloadURL = fmt.Sprintf("%s?v=%d", downloadURL, time.Now().Unix())

	log.Printf("[API] ✓ Uploaded to R2: %s", downloadURL)

	// ── Save/update record in PostgreSQL (keyed by compositeURL) ──
	filter := &model.FilterList{
		Name:           name,
		URL:            compositeURL,
		R2DownloadLink: downloadURL,
		RuleCount:      result.RuleCount,
		FileSize:       result.FileSize,
	}
	if err := h.db.UpsertFilter(ctx, filter); err != nil {
		log.Printf("[API] ⚠ DB upsert failed (upload succeeded): %v", err)
		// Still return success since the upload worked
	}
	log.Printf("[API] ✓ DB record upserted: url=%s (id=%d)", compositeURL, filter.ID)

	// ── Return success response ──
	c.JSON(http.StatusOK, model.BuildResponse{
		Status:      "success",
		DownloadURL: downloadURL,
		RuleCount:   result.RuleCount,
		FileSize:    result.FileSize,
	})
}

// Combine handles GET & POST /api/combine
// Merges multiple filter lists into plain-text adblock, domains, or hosts format.
// Query parameters (GET) or JSON body (POST):
// - urls: list of URLs (comma-separated for GET or string[] for POST)
// - format: "adblock" (default), "domains", or "hosts"
func (h *BuildHandler) Combine(c *gin.Context) {
	var urls []string
	var format string

	if c.Request.Method == http.MethodGet {
		rawURLs := c.Query("urls")
		if rawURLs != "" {
			for _, u := range strings.Split(rawURLs, ",") {
				if trimmed := strings.TrimSpace(u); trimmed != "" {
					urls = append(urls, trimmed)
				}
			}
		}
		if singleURL := strings.TrimSpace(c.Query("url")); singleURL != "" {
			urls = append(urls, singleURL)
		}
		format = c.DefaultQuery("format", "adblock")
	} else {
		var req model.CombineRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{
				Status:  "error",
				Message: "Invalid request body: " + err.Error(),
			})
			return
		}
		urls = req.URLs
		if len(urls) == 0 && req.URL != "" {
			urls = []string{req.URL}
		}
		format = req.Format
	}

	var cleanURLs []string
	for _, u := range urls {
		if trimmed := strings.TrimSpace(u); trimmed != "" {
			cleanURLs = append(cleanURLs, trimmed)
		}
	}

	if len(cleanURLs) == 0 {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "No filter list URL(s) provided. Use ?urls=url1,url2 or send JSON { \"urls\": [\"...\"] }",
		})
		return
	}

	data, ruleCount, err := compiler.CombineFilterLists(cleanURLs, format)
	if err != nil {
		if errors.Is(err, compiler.ErrNoRulesFound) {
			c.JSON(http.StatusBadRequest, model.ErrorResponse{
				Status:  "error",
				Message: "No rules found in provided filter lists",
			})
			return
		}
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Failed to combine filter lists: " + err.Error(),
		})
		return
	}

	c.Header("Content-Type", "text/plain; charset=utf-8")
	c.Header("Cache-Control", "public, max-age=3600")
	c.Header("X-Rule-Count", strconv.Itoa(ruleCount))
	c.String(http.StatusOK, string(data))
}

// RebuildAll handles POST /api/filters/rebuild-all — triggers asynchronous rebuilds of all stored filters.
func (h *BuildHandler) RebuildAll(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	filters, err := h.db.GetAllFilters(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "Failed to fetch filters: " + err.Error(),
		})
		return
	}

	// Because rebuilding can take a long time, we run it asynchronously and return immediately.
	go func() {
		bgCtx := context.Background() // Don't use gin context which cancels when request ends
		for _, filter := range filters {
			log.Printf("[API RebuildAll] Rebuilding '%s' (%s)", filter.Name, filter.URL)
			
			// Validate
			if err := compiler.ValidateFilterListURL(filter.URL); err != nil {
				log.Printf("[API RebuildAll] URL validation failed for %s: %v", filter.URL, err)
				_ = h.db.DeleteFilterByURL(bgCtx, filter.URL)
				log.Printf("[API RebuildAll] Removed failed filter %s from DB", filter.URL)
				continue
			}

			// Compile
			result, err := compiler.CompileFilterList(filter.Name, filter.URL)
			if err != nil {
				log.Printf("[API RebuildAll] Compilation failed for %s: %v", filter.URL, err)
				if h.notifier != nil {
					h.notifier.NotifyBuildFailure(filter.URL, "[RebuildAll] Compilation failed: "+err.Error())
				}
				_ = h.db.DeleteFilterByURL(bgCtx, filter.URL)
				log.Printf("[API RebuildAll] Removed failed filter %s from DB", filter.URL)
				continue
			}

			// Upload
			uploadCtx, uploadCancel := context.WithTimeout(bgCtx, 2*time.Minute)
			downloadURL, err := h.r2.UploadZip(uploadCtx, filter.Name, result.ZipData)
			uploadCancel()
			if err != nil {
				log.Printf("[API RebuildAll] R2 upload failed for %s: %v", filter.URL, err)
				if h.notifier != nil {
					h.notifier.NotifyBuildFailure(filter.URL, "[RebuildAll] R2 upload failed: "+err.Error())
				}
				_ = h.db.DeleteFilterByURL(bgCtx, filter.URL)
				log.Printf("[API RebuildAll] Removed failed filter %s from DB", filter.URL)
				continue
			}

			// Cache-buster query to prevent CDN from serving old versions
			downloadURL = fmt.Sprintf("%s?v=%d", downloadURL, time.Now().Unix())

			// Update DB
			updateFilter := filter
			updateFilter.R2DownloadLink = downloadURL
			updateFilter.RuleCount = result.RuleCount
			updateFilter.FileSize = result.FileSize
			
			dbCtx, dbCancel := context.WithTimeout(bgCtx, 30*time.Second)
			if err := h.db.UpsertFilter(dbCtx, &updateFilter); err != nil {
				log.Printf("[API RebuildAll] DB upsert failed for %s: %v", filter.URL, err)
			}
			dbCancel()
			log.Printf("[API RebuildAll] ✓ Successfully rebuilt '%s'", filter.Name)
		}
		log.Printf("[API RebuildAll] ✓ All filters have been rebuilt")
	}()

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": fmt.Sprintf("Started rebuilding %d filters in the background", len(filters)),
	})
}

// ListFilters handles GET /api/filters — returns filter lists with pagination and search.
// Query parameters:
//   - page (int): defaults to 1
//   - limit (int): defaults to 10
//   - search (string): optional search snippet
func (h *BuildHandler) ListFilters(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		page = 1
	}

	limit, err := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if err != nil || limit < 1 {
		limit = 10
	}
	if limit > 100 { // Max limit 100 per page to save resources
		limit = 100
	}

	search := c.Query("search")
	sort := c.Query("sort")
	order := c.Query("order")

	filters, totalRecords, err := h.db.GetFiltersPaginated(ctx, page, limit, search, sort, order)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "Failed to fetch filters: " + err.Error(),
		})
		return
	}

	totalPages := int(math.Ceil(float64(totalRecords) / float64(limit)))

	c.JSON(http.StatusOK, model.PaginatedResponse{
		Data: filters,
		Meta: model.PaginationMeta{
			CurrentPage:  page,
			Limit:        limit,
			TotalRecords: totalRecords,
			TotalPages:   totalPages,
		},
	})
}

// DeleteFilter handles DELETE /api/filters — deletes a filter by URL.
// Requires Authorization: Bearer <token> header (enforced by middleware).
//
// Query parameter: ?url=https://example.com/filter.txt
func (h *BuildHandler) DeleteFilter(c *gin.Context) {
	filterURL := c.Query("url")
	if filterURL == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Query parameter 'url' is required",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	// Look up the filter by URL to get the name for R2 deletion
	filter, err := h.db.GetFilterByURL(ctx, filterURL)
	if err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{
			Status:  "error",
			Message: err.Error(),
		})
		return
	}

	// Delete from R2
	if err := h.r2.DeleteObject(ctx, filter.Name); err != nil {
		log.Printf("[API] ⚠ R2 delete warning for '%s': %v", filter.Name, err)
		// Continue to delete from DB even if R2 fails
	}

	// Delete from DB
	if err := h.db.DeleteFilterByURL(ctx, filterURL); err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "Failed to delete filter: " + err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Filter deleted",
	})
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// skipSegments are common path segments that don't add meaning to the name.
var skipSegments = map[string]bool{
	"raw":    true,
	"master": true,
	"main":   true,
	"latest": true,
	"refs":   true,
	"heads":  true,
	"gh":     true,
	"download":  true,
	"downloads": true,
	"extension": true,
}

// deriveNameFromURL extracts a descriptive, unique name from a URL by combining
// meaningful path segments and appending a short hash of the full URL.
//
// Examples:
//
//	https://raw.githubusercontent.com/RPiList/specials/master/Blocklisten/malware
//	  → rpilist_blocklisten_malware_a1b2c3d4
//
//	https://filters.adtidy.org/extension/ublock/filters/2.txt
//	  → adtidy_ublock_filters_2_f9e8d7c6
//
//	https://easylist.to/easylist/easylist.txt
//	  → easylist_easylist_b5c4a3e2
func deriveNameFromURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return "filter"
	}

	// ── 1. Extract meaningful parts from the host ──
	host := strings.ToLower(parsed.Host)
	// Remove common prefixes and suffixes
	host = strings.TrimPrefix(host, "www.")
	host = strings.TrimPrefix(host, "raw.")
	host = strings.TrimPrefix(host, "cdn.")
	// Strip known hosting domains to keep just the owner/org
	for _, suffix := range []string{
		".githubusercontent.com",
		".github.io",
		".jsdelivr.net",
		".gitlab.io",
	} {
		if strings.HasSuffix(host, suffix) {
			host = strings.TrimSuffix(host, suffix)
			break
		}
	}
	// Remove TLD-like suffixes (.com, .org, .to, etc.) for cleaner names
	if idx := strings.LastIndex(host, "."); idx > 0 {
		host = host[:idx]
	}

	// ── 2. Extract meaningful parts from the path ──
	path := strings.Trim(parsed.Path, "/")
	segments := strings.Split(path, "/")

	var meaningful []string
	for _, seg := range segments {
		seg = strings.ToLower(seg)
		// Remove file extensions
		for _, ext := range []string{".txt", ".csv", ".hosts", ".list", ".php"} {
			seg = strings.TrimSuffix(seg, ext)
		}
		if seg == "" || skipSegments[seg] {
			continue
		}
		meaningful = append(meaningful, seg)
	}

	// ── 3. Build the name: host + meaningful path segments ──
	var parts []string

	// Add host part if it's informative
	hostClean := strings.NewReplacer(".", "_", "-", "_").Replace(host)
	if hostClean != "" {
		parts = append(parts, hostClean)
	}

	// Add meaningful path segments (limit to avoid absurdly long names)
	maxSegments := 3
	if len(meaningful) > maxSegments {
		meaningful = meaningful[len(meaningful)-maxSegments:]
	}
	parts = append(parts, meaningful...)

	// ── 4. Append short hash of the full URL for guaranteed uniqueness ──
	hash := sha256.Sum256([]byte(rawURL))
	shortHash := hex.EncodeToString(hash[:4]) // 8 hex chars

	if len(parts) == 0 {
		return "filter_" + shortHash
	}

	// Replace any remaining unsafe chars
	replacer := strings.NewReplacer(".", "_", "-", "_", " ", "_", "@", "")
	name := replacer.Replace(strings.Join(parts, "_"))

	return name + "_" + shortHash
}

// sanitizeName cleans up a filter name for use as a filename.
func sanitizeName(name string) string {
	name = strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
		case r == '-' || r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('_')
		}
	}
	return b.String()
}

// formatBytes returns a human-readable byte count string.
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMG"[exp])
}
