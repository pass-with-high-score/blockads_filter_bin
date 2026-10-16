// Package model defines database models and API request/response payloads.
package model

import "time"

// ────────────────────────────────────────────────────────────────────────────
// Database Model
// ────────────────────────────────────────────────────────────────────────────

// FilterList represents a compiled filter list record in PostgreSQL.
type FilterList struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	URL            string    `json:"url"`
	R2DownloadLink string    `json:"r2DownloadLink"`
	RuleCount      int       `json:"ruleCount"`
	FileSize       int64     `json:"fileSize"`
	LastUpdated    time.Time `json:"lastUpdated"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ────────────────────────────────────────────────────────────────────────────
// API Request / Response Payloads
// ────────────────────────────────────────────────────────────────────────────

// BuildRequest is the JSON body for POST /api/build.
// Supports either a single "url" or multiple "urls" to merge into a single filter.
type BuildRequest struct {
	URL  string   `json:"url"`
	URLs []string `json:"urls"`
	Name string   `json:"name"`
}

// CombineRequest is the JSON body for POST /api/combine.
type CombineRequest struct {
	URLs   []string `json:"urls"`
	URL    string   `json:"url"`
	Format string   `json:"format"` // "adblock", "domains", "hosts"
}

// BuildResponse is the JSON response for a successful build.
type BuildResponse struct {
	Status      string `json:"status"`
	DownloadURL string `json:"downloadUrl"`
	RuleCount   int    `json:"ruleCount"`
	FileSize    int64  `json:"fileSize"`
}

// ErrorResponse is the standard error JSON response.
type ErrorResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// InfoJSON is the metadata file included inside the zip archive.
type InfoJSON struct {
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	RuleCount int       `json:"ruleCount"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ────────────────────────────────────────────────────────────────────────────
// Pagination Payloads
// ────────────────────────────────────────────────────────────────────────────

// PaginationMeta contains metadata for a paginated API response.
type PaginationMeta struct {
	CurrentPage  int   `json:"current_page"`
	Limit        int   `json:"limit"`
	TotalRecords int64 `json:"total_records"`
	TotalPages   int   `json:"total_pages"`
}

// PaginatedResponse is a generic paginated response structure.
type PaginatedResponse struct {
	Data interface{}    `json:"data"`
	Meta PaginationMeta `json:"meta"`
}
