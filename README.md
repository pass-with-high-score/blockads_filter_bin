# BlockAds Filter Compiler

A high-performance Golang backend that downloads raw ad-blocking filter lists, compiles them into optimized binary formats (`.trie`, `.bloom`, `.css`), packages everything into a `.zip`, uploads to **Cloudflare R2**, and tracks metadata in **PostgreSQL**.

Available mode:

| Mode           | Entry Point          | Use Case                                                           |
|----------------|----------------------|--------------------------------------------------------------------|
| **API Server** | `cmd/server/main.go` | Production backend with REST API, R2 upload, DB, and daily cron    |

---

## Architecture

```
POST /api/build { url }
        │
        ▼
   ┌──────────────────────────────────────────────┐
   │  1. Validate URL (HEAD request)              │
   │  2. Stream download (bufio.Scanner)          │
   │  3. Parse domains + cosmetic CSS rules       │
   │  4. Build Trie (reversed-label, BFS binary)  │
   │  5. Build Bloom Filter (FNV double-hashing)  │
   │  6. Format CSS (display:none !important)     │
   │  7. Package .trie + .bloom + .css + info.json│
   │     into [name].zip (in-memory)              │
   │  8. Upload .zip → Cloudflare R2              │
   │  9. Upsert record → PostgreSQL               │
   └──────────────────────────────────────────────┘
        │
        ▼
   { "status": "success", "downloadUrl": "https://pub-xyz.r2.dev/MyFilter.zip" }
```

### Background Cron Job

A daily cron (`@midnight UTC`) automatically:
1. Queries all saved filter URLs from PostgreSQL
2. Re-downloads, re-compiles, re-zips concurrently (bounded goroutines)
3. Re-uploads to R2 and updates `last_updated` timestamps

---

## Project Structure

```
blockads_filter_bin/
├── cmd/server/main.go          # API server entry point (Gin + graceful shutdown)
├── internal/
│   ├── compiler/compiler.go    # Core: download → parse → trie → bloom → css → zip
│   ├── config/config.go        # Environment-based configuration
│   ├── cron/scheduler.go       # Daily auto-update cron job (robfig/cron)
│   ├── handler/handler.go      # HTTP handlers (POST /api/build, GET/DELETE filters)
│   ├── model/model.go          # DB models + API request/response payloads
│   ├── storage/r2.go           # Cloudflare R2 client (aws-sdk-go-v2, S3-compat)
│   └── store/postgres.go       # PostgreSQL queries + auto-migration (pgx)
├── Dockerfile                  # Multi-stage production build (~15MB)
├── docker-compose.yml          # PostgreSQL + API server
├── Makefile                    # Common dev commands
└── bloom_trie_build_doc.md     # Binary format specification
```

---

## Prerequisites

- [Go](https://go.dev/doc/install) 1.22+
- [PostgreSQL](https://www.postgresql.org/) 14+ (or use Docker Compose)
- A [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket with API credentials

---

## Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/pass-with-high-score/blockads_filter_bin.git
cd blockads_filter_bin
go mod tidy
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual credentials
```

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Server port | `8080` |
| `ENVIRONMENT` | Run environment | `development` |
| `ADMIN_TOKEN` | Auth token for destructive actions | `your_secret_admin_token` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://user:pass@localhost:5432/blockads?sslmode=disable` |
| `R2_ACCOUNT_ID` | Cloudflare Account ID | `abc123def456` |
| `R2_ACCESS_KEY_ID` | R2 API Token Key ID | `your_access_key` |
| `R2_SECRET_ACCESS_KEY` | R2 API Token Secret | `your_secret_key` |
| `R2_BUCKET_NAME` | R2 Bucket Name | `blockads-filters` |
| `R2_PUBLIC_URL` | R2 Public Access URL | `https://pub-xyz.r2.dev` |

### 3a. Run with Docker Compose

```bash
docker compose up --build -d
```

This starts the API server using the external PostgreSQL database defined in your `.env` file (`DATABASE_URL`). The database schema is auto-migrated on startup.

### 3b. Run Locally (Development)

```bash
# Ensure your external PostgreSQL database is accessible
make run
# or
go run ./cmd/server
```

---

## API Reference

### `POST /api/build` — Compile a filter list

(Optional: Append `?force=true` to force a recompile if the URL already exists in the database.)

**Request:**
```json
{
  "url": "https://example.com/filter.txt"
}
```

*Note: The filter `name` is automatically derived securely and uniquely from the provided URL (e.g., `example_filter_a1b2c3d4`).*

**Response (200 OK):**
```json
{
  "status": "success",
  "downloadUrl": "https://pub-xyz.r2.dev/MyFilter.zip",
  "ruleCount": 48231,
  "fileSize": 1245678
}
```

**Error (400 Bad Request):**
```json
{
  "status": "error",
  "message": "URL validation failed: URL is not reachable: ..."
}
```

### `GET /api/filters` — List all compiled filters

**Response:**
```json
{
  "status": "success",
  "count": 2,
  "filters": [
    {
      "id": 1,
      "name": "MyFilter",
      "url": "https://example.com/filter.txt",
      "r2DownloadLink": "https://pub-xyz.r2.dev/MyFilter.zip",
      "ruleCount": 48231,
      "fileSize": 1245678,
      "lastUpdated": "2026-03-18T10:00:00Z",
      "createdAt": "2026-03-17T15:30:00Z"
    }
  ]
}
```

### `DELETE /api/filters` — Delete a filter

**Requires Header:** `Authorization: Bearer <ADMIN_TOKEN>`

Removes the zip from R2 and the record from PostgreSQL. Requires the `url` as a query parameter.

**Example Request:**
```bash
curl -X DELETE "http://localhost:8080/api/filters?url=https://example.com/filter.txt" \
  -H "Authorization: Bearer your_secret_admin_token"
```

### `GET /health` — Health check

```json
{ "status": "ok", "time": "2026-03-18T10:30:00Z" }
```

---

## ZIP Archive Contents

Each compiled `.zip` contains:

| File           | Description                                                              |
|----------------|--------------------------------------------------------------------------|
| `[name].trie`  | Binary Trie tree (magic `0x54524945`, big-endian, BFS-ordered)           |
| `[name].bloom` | Bloom Filter (magic `0x424C4F4D`, FNV-1a/FNV-1 double-hashing, FPR 0.1%) |
| `[name].css`   | Cosmetic filter rules (e.g. `.banner { display: none !important; }`)     |
| `info.json`    | Metadata: `{ name, url, ruleCount, updatedAt }`                          |

Both `.trie` and `.bloom` files are designed for **zero-copy mmap** consumption by the BlockAds Android/iOS Go engine.

---



## Makefile Commands

```bash
make deps       # Download Go module dependencies
make build      # Build the API server binary → bin/server
make run        # Run the API server locally
make test       # Run all tests
make clean      # Remove build artifacts
```

---

## Database Schema

Auto-migrated on server startup:

```sql
CREATE TABLE filter_lists (
    id               BIGSERIAL    PRIMARY KEY,
    name             TEXT         NOT NULL,
    url              TEXT         NOT NULL UNIQUE,
    r2_download_link TEXT         NOT NULL DEFAULT '',
    rule_count       INTEGER      NOT NULL DEFAULT 0,
    file_size        BIGINT       NOT NULL DEFAULT 0,
    last_updated     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filter_lists_url ON filter_lists (url);
```

---

## Key Design Decisions

- **Memory Efficiency**: All filter list downloads are processed line-by-line via `bufio.Scanner`. The raw text is never loaded entirely into memory, preventing OOM on lists with millions of rules.
- **In-Memory Zip**: The `.trie`, `.bloom`, `.css`, and `info.json` are built as byte slices and zipped in-memory — no temp files on disk.
- **Smart Caching & Upserts**: `POST /api/build` ensures we don't duplicate work. Existing URLs are immediately returned from DB unless overridden with `?force=true`. The database uses the `url` as the unique identity for conflict resolution during upserts.
- **Bounded Concurrency**: The cron job uses a semaphore pattern (`chan struct{}`) to cap goroutines and prevent CPU/network spikes.
- **Binary Compatibility**: The `.trie` and `.bloom` formats are byte-identical to those produced by the Kotlin `DomainTrie`/`BloomFilterBuilder` on Android, ensuring cross-platform interoperability.

---

## License

MIT
