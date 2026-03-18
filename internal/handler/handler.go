// Package handler contains the HTTP request handlers for the API.
package handler

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"regexp"
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

// validNameRegex allows only alphanumeric, hyphens, and underscores.
var validNameRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

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

// Build handles POST /api/build
//
// Request Body:
//
//	{"name": "MyFilter", "url": "https://example.com/filter.txt"}
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

	// Sanitize name: trim whitespace, replace spaces with underscores
	req.Name = sanitizeName(req.Name)

	if !validNameRegex.MatchString(req.Name) {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Invalid name: must be 1-64 alphanumeric characters, hyphens, or underscores",
		})
		return
	}

	// ── Validate URL is reachable ──
	log.Printf("[API] Validating URL: %s", req.URL)
	if err := compiler.ValidateURL(req.URL); err != nil {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "URL validation failed: " + err.Error(),
		})
		return
	}

	// ── Compile the filter list ──
	log.Printf("[API] Starting compilation for '%s'", req.Name)
	result, err := compiler.CompileFilterList(req.Name, req.URL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "Compilation failed: " + err.Error(),
		})
		return
	}

	// ── Upload to Cloudflare R2 ──
	log.Printf("[API] Uploading %s.zip to R2 (%s)", req.Name, formatBytes(result.FileSize))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	downloadURL, err := h.r2.UploadZip(ctx, req.Name, result.ZipData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, model.ErrorResponse{
			Status:  "error",
			Message: "R2 upload failed: " + err.Error(),
		})
		return
	}
	log.Printf("[API] ✓ Uploaded to R2: %s", downloadURL)

	// ── Save/update record in PostgreSQL ──
	filter := &model.FilterList{
		Name:           req.Name,
		URL:            req.URL,
		R2DownloadLink: downloadURL,
		RuleCount:      result.RuleCount,
		FileSize:       result.FileSize,
	}
	if err := h.db.UpsertFilter(ctx, filter); err != nil {
		log.Printf("[API] ⚠ DB upsert failed (upload succeeded): %v", err)
		// Still return success since the upload worked
	}
	log.Printf("[API] ✓ DB record upserted: %s (id=%d)", req.Name, filter.ID)

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

// DeleteFilter handles DELETE /api/filters/:name — deletes a filter by name.
func (h *BuildHandler) DeleteFilter(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, model.ErrorResponse{
			Status:  "error",
			Message: "Filter name is required",
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	// Delete from R2
	if err := h.r2.DeleteObject(ctx, name); err != nil {
		log.Printf("[API] ⚠ R2 delete warning for '%s': %v", name, err)
		// Continue to delete from DB even if R2 fails (might already be deleted)
	}

	// Delete from DB
	if err := h.db.DeleteFilterByName(ctx, name); err != nil {
		c.JSON(http.StatusNotFound, model.ErrorResponse{
			Status:  "error",
			Message: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "Filter '" + name + "' deleted",
	})
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

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
		// Skip all other characters
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
