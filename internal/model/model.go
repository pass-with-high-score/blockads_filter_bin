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
type BuildRequest struct {
	Name string `json:"name" binding:"required"`
	URL  string `json:"url"  binding:"required,url"`
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
