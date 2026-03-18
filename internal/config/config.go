// Package config loads application configuration from environment variables.
// It supports .env files via github.com/joho/godotenv for local development.
package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

// Config holds all application configuration values.
type Config struct {
	// Server
	Port        string
	Environment string

	// PostgreSQL
	DatabaseURL string

	// Cloudflare R2 (S3-compatible)
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2PublicURL       string // e.g. "https://filter.pwhs.app"

	// Compilation
	MaxConcurrency int
	TempDir        string
}

// Load reads configuration from a .env file (if present) and environment variables.
func Load() *Config {
	// Load .env file if it exists (silently ignored in production)
	if err := godotenv.Load(); err != nil {
		log.Println("ℹ No .env file found, using system environment variables")
	}

	return &Config{
		Port:        getEnv("PORT", "8080"),
		Environment: getEnv("ENVIRONMENT", "development"),

		DatabaseURL: getEnv("DATABASE_URL", "postgres://blockads:blockads@localhost:5432/blockads?sslmode=disable"),

		R2AccountID:       getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:      getEnv("R2_BUCKET_NAME", "blockads-filters"),
		R2PublicURL:       getEnv("R2_PUBLIC_URL", ""),

		MaxConcurrency: 4,
		TempDir:        getEnv("TEMP_DIR", os.TempDir()),
	}
}

// getEnv reads an environment variable or returns a default value.
func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
