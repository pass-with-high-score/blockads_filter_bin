// Package handler contains the HTTP request handlers for the API.
package handler

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"

	"blockads-filtering/internal/compiler"
	"blockads-filtering/internal/config"
	"blockads-filtering/internal/model"
	"blockads-filtering/internal/storage"
	"blockads-filtering/internal/store"

	"github.com/gin-gonic/gin"
)

// BuildHandler processes filter list build requests.
type BuildHandler struct {
	db  *store.Postgres
	r2  *storage.R2Client
	cfg *config.Config
}

// NewBuildHandler creates a new BuildHandler with all dependencies injected.
func NewBuildHandler(db *store.Postgres, r2 *storage.R2Client, cfg *config.Config) *BuildHandler {
	return &BuildHandler{db: db, r2: r2, cfg: cfg}
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
//
// Name is auto-derived from the URL.
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

	// ── Check if URL already exists in the database ──
	// Skip re-compilation unless ?force=true is set
	forceRebuild := strings.EqualFold(c.Query("force"), "true")
	if !forceRebuild {
		existing, err := h.db.GetFilterByURL(c.Request.Context(), req.URL)
		if err == nil && existing != nil {
			log.Printf("[API] URL already exists in DB: %s (id=%d), returning existing record", req.URL, existing.ID)
			c.JSON(http.StatusOK, model.BuildResponse{
				Status:      "success",
				DownloadURL: existing.R2DownloadLink,
				RuleCount:   existing.RuleCount,
				FileSize:    existing.FileSize,
			})
			return
		}
	}

	// Derive name from the URL
	name := deriveNameFromURL(req.URL)
	name = sanitizeName(name)

	if name == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Could not derive a valid name from the provided URL",
		})
		return
	}

	// ── Validate URL is reachable ──
	log.Printf("[API] Validating URL: %s", req.URL)
	if err := compiler.ValidateFilterListURL(req.URL); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "URL validation failed: " + err.Error(),
		})
		return
	}

	// ── Compile the filter list ──
	log.Printf("[API] Starting compilation for '%s' (derived from URL)", name)
	result, err := compiler.CompileFilterList(name, req.URL)
	if err != nil {
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
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "R2 upload failed: " + err.Error(),
		})
		return
	}
	log.Printf("[API] ✓ Uploaded to R2: %s", downloadURL)

	// ── Save/update record in PostgreSQL (keyed by URL) ──
	filter := &model.FilterList{
		Name:           name,
		URL:            req.URL,
		R2DownloadLink: downloadURL,
		RuleCount:      result.RuleCount,
		FileSize:       result.FileSize,
	}
	if err := h.db.UpsertFilter(ctx, filter); err != nil {
		log.Printf("[API] ⚠ DB upsert failed (upload succeeded): %v", err)
		// Still return success since the upload worked
	}
	log.Printf("[API] ✓ DB record upserted: url=%s (id=%d)", req.URL, filter.ID)

	// ── Return success response ──
	c.JSON(http.StatusOK, model.BuildResponse{
		Status:      "success",
		DownloadURL: downloadURL,
		RuleCount:   result.RuleCount,
		FileSize:    result.FileSize,
	})
}

// ListFilters handles GET /api/filters — returns all saved filter lists.
func (h *BuildHandler) ListFilters(c *gin.Context) {
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

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"filters": filters,
		"count":   len(filters),
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
