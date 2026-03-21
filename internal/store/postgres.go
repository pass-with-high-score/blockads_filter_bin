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

// migrate creates the filter_lists table and ensures the schema is up-to-date.
// Handles upgrades from the old schema (UNIQUE on name → UNIQUE on url).
func (db *Postgres) migrate(ctx context.Context) error {
	query := `
		CREATE TABLE IF NOT EXISTS filter_lists (
			id              BIGSERIAL PRIMARY KEY,
			name            TEXT        NOT NULL,
			url             TEXT        NOT NULL,
			r2_download_link TEXT       NOT NULL DEFAULT '',
			rule_count      INTEGER     NOT NULL DEFAULT 0,
			file_size       BIGINT      NOT NULL DEFAULT 0,
			last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		-- Drop old unique constraint on name if it exists (schema v1 → v2 migration)
		DO $$ BEGIN
			IF EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'filter_lists_name_key'
			) THEN
				ALTER TABLE filter_lists DROP CONSTRAINT filter_lists_name_key;
			END IF;
		END $$;

		-- Ensure unique constraint on url exists
		DO $$ BEGIN
			IF NOT EXISTS (
				SELECT 1 FROM pg_constraint
				WHERE conname = 'filter_lists_url_key'
			) THEN
				ALTER TABLE filter_lists ADD CONSTRAINT filter_lists_url_key UNIQUE (url);
			END IF;
		END $$;

		CREATE INDEX IF NOT EXISTS idx_filter_lists_url ON filter_lists (url);
	`
	_, err := db.pool.Exec(ctx, query)
	return err
}

// UpsertFilter inserts a new filter list record or updates an existing one (by URL).
// Uses ON CONFLICT (url) DO UPDATE to perform an upsert.
func (db *Postgres) UpsertFilter(ctx context.Context, f *model.FilterList) error {
	query := `
		INSERT INTO filter_lists (name, url, r2_download_link, rule_count, file_size, last_updated)
		VALUES ($1, $2, $3, $4, $5, NOW())
		ON CONFLICT (url) DO UPDATE
		SET name             = EXCLUDED.name,
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

// GetFiltersPaginated returns filter list records with pagination and optional search filter.
func (db *Postgres) GetFiltersPaginated(ctx context.Context, page, limit int, search string) ([]model.FilterList, int64, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 10
	}
	offset := (page - 1) * limit

	var totalRecords int64
	var countQuery string
	var countArgs []interface{}

	if search != "" {
		countQuery = "SELECT COUNT(*) FROM filter_lists WHERE name ILIKE $1 OR url ILIKE $1"
		countArgs = append(countArgs, "%"+search+"%")
	} else {
		countQuery = "SELECT COUNT(*) FROM filter_lists"
	}

	err := db.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&totalRecords)
	if err != nil {
		return nil, 0, err
	}

	var dataQuery string
	var dataArgs []interface{}

	if search != "" {
		dataQuery = `
			SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
			FROM filter_lists
			WHERE name ILIKE $1 OR url ILIKE $1
			ORDER BY last_updated DESC
			LIMIT $2 OFFSET $3
		`
		dataArgs = append(dataArgs, "%"+search+"%", limit, offset)
	} else {
		dataQuery = `
			SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
			FROM filter_lists
			ORDER BY last_updated DESC
			LIMIT $1 OFFSET $2
		`
		dataArgs = append(dataArgs, limit, offset)
	}

	rows, err := db.pool.Query(ctx, dataQuery, dataArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var filters []model.FilterList
	for rows.Next() {
		var f model.FilterList
		if err := rows.Scan(&f.ID, &f.Name, &f.URL, &f.R2DownloadLink,
			&f.RuleCount, &f.FileSize, &f.LastUpdated, &f.CreatedAt); err != nil {
			return nil, 0, err
		}
		filters = append(filters, f)
	}
	
	if filters == nil {
		filters = []model.FilterList{}
	}

	return filters, totalRecords, rows.Err()
}

// GetFilterByURL retrieves a single filter list record by its URL.
func (db *Postgres) GetFilterByURL(ctx context.Context, url string) (*model.FilterList, error) {
	query := `
		SELECT id, name, url, r2_download_link, rule_count, file_size, last_updated, created_at
		FROM filter_lists
		WHERE url = $1
	`
	var f model.FilterList
	err := db.pool.QueryRow(ctx, query, url).Scan(
		&f.ID, &f.Name, &f.URL, &f.R2DownloadLink,
		&f.RuleCount, &f.FileSize, &f.LastUpdated, &f.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("filter with URL '%s' not found", url)
	}
	return &f, nil
}

// DeleteFilterByURL removes a filter list record by its URL.
func (db *Postgres) DeleteFilterByURL(ctx context.Context, url string) error {
	tag, err := db.pool.Exec(ctx, `DELETE FROM filter_lists WHERE url = $1`, url)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("filter with URL '%s' not found", url)
	}
	return nil
}
