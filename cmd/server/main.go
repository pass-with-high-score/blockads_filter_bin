// Package main is the entry point for the BlockAds Filter Compiler API server.
// It wires together all internal packages (config, store, storage, handler, cron)
// into a Gin-based HTTP server with graceful shutdown and a daily cron job.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"blockads-filtering/internal/config"
	"blockads-filtering/internal/cron"
	"blockads-filtering/internal/handler"
	"blockads-filtering/internal/storage"
	"blockads-filtering/internal/store"

	"github.com/gin-gonic/gin"
)

func main() {
	log.SetFlags(log.Ltime | log.Lmicroseconds)
	log.Println("╔══════════════════════════════════════════════════════╗")
	log.Println("║   BlockAds Filter Compiler API                     ║")
	log.Println("║   REST API · R2 Upload · PostgreSQL · Daily Cron   ║")
	log.Println("╚══════════════════════════════════════════════════════╝")

	// ── 1. Load configuration ──
	cfg := config.Load()
	log.Printf("Environment: %s | Port: %s", cfg.Environment, cfg.Port)

	// ── 2. Connect to PostgreSQL ──
	db, err := store.NewPostgres(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("✗ Failed to connect to PostgreSQL: %v", err)
	}
	defer db.Close()
	log.Println("✓ Connected to PostgreSQL (schema auto-migrated)")

	// ── 3. Initialize Cloudflare R2 client ──
	r2, err := storage.NewR2Client(cfg)
	if err != nil {
		log.Fatalf("✗ Failed to initialize R2 client: %v", err)
	}
	log.Printf("✓ R2 client ready (bucket: %s)", cfg.R2BucketName)

	// ── 4. Set up Gin router ──
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Logger(), gin.Recovery())

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status": "ok",
			"time":   time.Now().UTC(),
		})
	})

	// API routes
	h := handler.NewBuildHandler(db, r2, cfg)
	api := router.Group("/api")
	{
		api.POST("/build", h.Build)
		api.GET("/filters", h.ListFilters)
		api.DELETE("/filters/:name", h.DeleteFilter)
	}

	// ── 5. Start daily cron scheduler ──
	scheduler := cron.NewScheduler(db, r2, cfg)
	scheduler.Start()
	log.Println("✓ Cron scheduler started (daily @midnight UTC)")

	// ── 6. Start HTTP server ──
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 300 * time.Second, // long timeout for compilation requests
		IdleTimeout:  120 * time.Second,
	}

	// Run server in a goroutine so we can listen for shutdown signals
	go func() {
		log.Printf("✓ Server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("✗ Server failed: %v", err)
		}
	}()

	// ── 7. Graceful shutdown ──
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("⏳ Received signal %v, shutting down gracefully...", sig)

	// Give outstanding requests 10 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	scheduler.Stop()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("✗ Server forced to shutdown: %v", err)
	}

	log.Println("✓ Server exited cleanly")
}
