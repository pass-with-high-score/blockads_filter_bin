# BlockAds Filter Bin & Compiler Service 🛡️

The central backend compiler and distribution engine for the **[BlockAds](https://github.com/pass-with-high-score/blockads-android)** ecosystem.

BlockAds uses a custom, memory-mapped binary filtering engine (`.trie`, `.bloom`, `.css`, and `.scriptlets`) built in Go. This repository provides both a serverless Next.js API (`complier.pwhs.app`) and native Go compilation tools to dynamically parse, optimize, compile, and distribute ad-blocking filter lists to mobile devices via Cloudflare R2 CDN.

---

## 🌟 Architecture & Flexibility

To ensure maximum flexibility, scalability, and ease of maintenance, the BlockAds filtering pipeline is consolidated here:

1. **Centralized Filter Management**: 
   - Replaces static GitHub-hosted filter files with dynamic database-backed storage (PostgreSQL on Supabase) and CDN distribution (Cloudflare R2).
   - Manages all 22 default built-in filter lists (EasyList, AdGuard, StevenBlack, Hagezi tiers, ABPVN, HostsVN, etc.) as well as user-submitted custom filter lists in one unified place.

2. **Full Filter Compilation Suite**:
   - **Trie (`.trie`)**: Binary mmap-friendly reversed-domain Trie tree for zero-allocation domain and subdomain matching in Go/Kotlin.
   - **Bloom Filter (`.bloom`)**: Space-efficient FNV-1a & FNV-1 double hashing filter with 0.1% False Positive Rate.
   - **Cosmetic CSS (`.css`)**: Extracted element-hiding CSS selectors with comments and unsupported syntax cleanly stripped.
   - **Scriptlets (`.scriptlets`)**: Full support for uBlock (`##+js`) and AdGuard (`#%#//scriptlet`) injection rules for YouTube and anti-adblock mitigation.
   - **Metadata (`info.json`)**: Versioning, timestamps, and rule count metrics.
   - **Package Archive (`.zip`)**: All artifacts bundled and compressed for fast atomic client updates.

3. **High-Performance CDN Delivery**:
   - Compilations are cached and served via Cloudflare R2 (`https://filter.pwhs.app/*.zip`) with HTTP query-based cache busting (`?v=timestamp`).

---

## 📡 API Endpoints

Base URL: `https://complier.pwhs.app`

### 1. Default Built-in Filters (For Mobile Apps)
- **Endpoint**: `GET /api/filters/default`
- **Description**: Returns all default filter lists with their CDN download links, rules counts, categories, and legacy fallback URLs.
- **Client**: Consumed directly by [blockads-android](https://github.com/pass-with-high-score/blockads-android) and [blockadstv](https://github.com/pass-with-high-score/blockads-android).

### 2. Compile Custom Filter List
- **Endpoint**: `POST /api/build`
- **Body**: `{ "url": "https://example.com/filter.txt" }`
- **Description**: Validates, parses, compiles, and uploads a custom filter list on-demand, returning the compiled zip download URL and rule counts.

### 3. List All Filters (Paginated)
- **Endpoint**: `GET /api/filters?page=1&limit=20&search=adguard`
- **Description**: Search and browse recently compiled filter lists.

### 4. Rebuild All Filters (Admin Cron)
- **Endpoint**: `POST /api/filters/rebuild-all`
- **Headers**: `Authorization: Bearer <ADMIN_TOKEN>`
- **Description**: Triggers background re-compilation of all filter lists to fetch upstream adblock changes.

---

## 🚀 Getting Started Locally

Ensure you have [Bun](https://bun.sh/) (or Node.js) and [Go](https://go.dev/) installed.

### Run Web & Serverless API
```bash
bun install
bun dev
```

### Run Local CLI Scripts
```bash
# Compile and sync missing default filters:
bun run scripts/compile-missing-defaults.ts

# Rebuild all database filters locally:
bun run scripts/rebuild-all.ts
```

### Native Go Engine Tests
```bash
go test ./...
go build ./...
```

---

## 📄 License
This project is open-source software licensed under the **[MIT License](./LICENSE)**.
