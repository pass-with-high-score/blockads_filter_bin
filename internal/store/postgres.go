// Package store handles PostgreSQL database operations using pgx.
package store

import (
	"context"
	"fmt"
	"time"

	"blockads-filtering/internal/model"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Postgres wraps a pgx connection pool and provides domain-specific queries.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres creates a new connection pool and runs schema migrations.
func NewPostgres(databaseURL string) (*Postgres, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parsing database URL: %w", err)
	}

	// Tune pool settings for a backend API workload
	poolConfig.MaxConns = 10
	poolConfig.MinConns = 2
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("creating connection pool: %w", err)
	}

	// Verify connectivity
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	db := &Postgres{pool: pool}

	// Run auto-migration
	if err := db.migrate(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("running migration: %w", err)
	}

	return db, nil
}

// Close shuts down the connection pool.
func (db *Postgres) Close() {
	db.pool.Close()
}

// migrate creates the filter_lists table if it does not exist.
func (db *Postgres) migrate(ctx context.Context) error {
	query := `
		CREATE TABLE IF NOT EXISTS filter_lists (
			id              BIGSERIAL PRIMARY KEY,
			name            TEXT        NOT NULL UNIQUE,
			url             TEXT        NOT NULL,
			r2_download_link TEXT       NOT NULL DEFAULT '',
			rule_count      INTEGER     NOT NULL DEFAULT 0,
			file_size       BIGINT      NOT NULL DEFAULT 0,
			last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_filter_lists_name ON filter_lists (name);
	`
	_, err := db.pool.Exec(ctx, query)
	return err
}

// UpsertFilter inserts a new filter list record or updates an existing one (by name).
// Uses ON CONFLICT (name) DO UPDATE to perform an upsert.
func (db *Postgres) UpsertFilter(ctx context.Context, f *model.FilterList) error {
	query := `
		INSERT INTO filter_lists (name, url, r2_download_link, rule_count, file_size, last_updated)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (name) DO UPDATE
		SET url              = EXCLUDED.url,
		    r2_download_link = EXCLUDED.r2_download_link,
		    rule_count       = EXCLUDED.rule_count,
		    file_size        = EXCLUDED.file_size,
		    last_updated     = NOW()
		RETURNING id, last_updated, created_at
	`
	return db.pool.QueryRow(ctx, query,
		f.Name,
		f.URL,
		f.R2DownloadLink,
		f.RuleCount,
		f.FileSize,
	).Scan(&f.ID, &f.LastUpdated, &f.CreatedAt)
}

// GetAllFilters returns all filter list records, ordered by name.
func (db *Postgres) GetAllFilters(ctx context.Context) ([]model.FilterList, error) {
	query := `
		SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
		FROM filter_lists
		ORDER BY name ASC
	`
	rows, err := db.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filters []model.FilterList
	for rows.Next() {
		var f model.FilterList
		if err := rows.Scan(&f.ID, &f.Name, &f.URL, &f.R2DownloadLink,
			&f.RuleCount, &f.FileSize, &f.LastUpdated, &f.CreatedAt); err != nil {
			return nil, err
		}
		filters = append(filters, f)
	}

	return filters, rows.Err()
}

// DeleteFilterByName removes a filter list record by its name.
func (db *Postgres) DeleteFilterByName(ctx context.Context, name string) error {
	tag, err := db.pool.Exec(ctx, `DELETE FROM filter_lists WHERE name = $1`, name)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("filter '%s' not found", name)
	}
	return nil
}
