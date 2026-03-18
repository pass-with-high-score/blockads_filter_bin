// Package cron implements the daily auto-update background job.
// It queries PostgreSQL for all saved filter URLs, re-downloads, re-compiles,
// re-zips, and re-uploads to Cloudflare R2 concurrently with bounded goroutines.
package cron

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"blockads-filtering/internal/compiler"
	"blockads-filtering/internal/config"
	"blockads-filtering/internal/model"
	"blockads-filtering/internal/storage"
	"blockads-filtering/internal/store"

	"github.com/robfig/cron/v3"
)

// Scheduler wraps the cron scheduler and its dependencies.
type Scheduler struct {
	cron *cron.Cron
	db   *store.Postgres
	r2   *storage.R2Client
	cfg  *config.Config
}

// NewScheduler creates a new cron scheduler with the daily auto-update job.
func NewScheduler(db *store.Postgres, r2 *storage.R2Client, cfg *config.Config) *Scheduler {
	s := &Scheduler{
		cron: cron.New(cron.WithSeconds()),
		db:   db,
		r2:   r2,
		cfg:  cfg,
	}

	// Schedule: run every 24 hours at midnight UTC
	_, err := s.cron.AddFunc("0 0 0 * * *", s.runAutoUpdate)
	if err != nil {
		log.Fatalf("Failed to register cron job: %v", err)
	}

	return s
}

// Start begins the cron scheduler in the background.
func (s *Scheduler) Start() {
	s.cron.Start()
}

// Stop gracefully shuts down the cron scheduler, waiting for running jobs.
func (s *Scheduler) Stop() {
	ctx := s.cron.Stop()
	<-ctx.Done()
	log.Println("✓ Cron scheduler stopped")
}

// runAutoUpdate is the cron job function that re-compiles all registered filters.
func (s *Scheduler) runAutoUpdate() {
	startTime := time.Now()
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	log.Println("[CRON] ▶ Starting daily auto-update of all filter lists")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	// Fetch all saved filters from the database
	filters, err := s.db.GetAllFilters(ctx)
	if err != nil {
		log.Printf("[CRON] ✗ Failed to fetch filters from DB: %v", err)
		return
	}

	if len(filters) == 0 {
		log.Println("[CRON] No filters in database, nothing to update")
		return
	}

	log.Printf("[CRON] Found %d filter(s) to update", len(filters))

	// Process concurrently with bounded goroutines
	maxConcurrent := s.cfg.MaxConcurrency
	if maxConcurrent <= 0 {
		maxConcurrent = 4
	}

	var (
		wg        sync.WaitGroup
		sem       = make(chan struct{}, maxConcurrent)
		mu        sync.Mutex
		succeeded int
		failed    int
	)

	for _, filter := range filters {
		wg.Add(1)
		go func(f model.FilterList) {
			defer wg.Done()

			sem <- struct{}{}        // acquire semaphore slot
			defer func() { <-sem }() // release slot

			log.Printf("[CRON] Recompiling '%s' from %s", f.Name, f.URL)

			// Re-compile
			result, err := compiler.CompileFilterList(f.Name, f.URL)
			if err != nil {
				log.Printf("[CRON] ✗ Compilation failed for '%s': %v", f.Name, err)
				mu.Lock()
				failed++
				mu.Unlock()
				return
			}

			// Re-upload to R2
			downloadURL, err := s.r2.UploadZip(ctx, f.Name, result.ZipData)
			if err != nil {
				log.Printf("[CRON] ✗ R2 upload failed for '%s': %v", f.Name, err)
				mu.Lock()
				failed++
				mu.Unlock()
				return
			}

			// Update database record
			updated := &model.FilterList{
				Name:           f.Name,
				URL:            f.URL,
				R2DownloadLink: downloadURL,
				RuleCount:      result.RuleCount,
				FileSize:       result.FileSize,
			}
			if err := s.db.UpsertFilter(ctx, updated); err != nil {
				log.Printf("[CRON] ⚠ DB update failed for '%s': %v", f.Name, err)
				// Don't count as failure since upload succeeded
			}

			log.Printf("[CRON] ✓ Updated '%s': %d rules, %s",
				f.Name, result.RuleCount, formatBytes(result.FileSize))

			mu.Lock()
			succeeded++
			mu.Unlock()
		}(filter)
	}

	wg.Wait()

	totalDuration := time.Since(startTime)
	log.Printf("[CRON] ✅ Auto-update complete: %d succeeded, %d failed (%.2fs)",
		succeeded, failed, totalDuration.Seconds())
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
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
