# Tài liệu: Cách App Build File Bloom Filter & Trie

## Tổng quan

BlockAds sử dụng **hai cấu trúc dữ liệu nhị phân** được lưu trên disk để tra cứu domain cực nhanh ở tầng Go:

| File | Mục đích |
|------|----------|
| `ad_domains.trie` / `security_domains.trie` | Lưu toàn bộ domain bị chặn dưới dạng cây Trie compact (binary, big-endian) |
| `ad_domains.bloom` / `security_domains.bloom` | Pre-filter xác suất: loại bỏ ~90% domain sạch trước khi tra Trie |

Cả hai file được **memory-mapped (mmap)** ở runtime → zero heap allocation, không cần load vào RAM.

---

## Pipeline Build (Kotlin Side)

```
Filter Lists (URLs)
      │
      ▼ download / đọc cache
 Raw Text Files (.txt)
      │
      ▼ parseHostsFileToTrie()
  DomainTrie (in-memory tree)
      │
      ├──► saveToBinary()  →  *.trie  (binary file)
      │
      └──► saveBloomFilter() →  *.bloom (binary file)
```

### Bước 1 – Parse domain vào DomainTrie

**File:** [`FilterListRepository.kt`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/FilterListRepository.kt#L934-L977), [`DomainTrie.kt`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/DomainTrie.kt)

Hàm `parseHostsFileToTrie()` đọc từng dòng và nhận 3 định dạng:

| Format | Ví dụ | Xử lý |
|--------|-------|-------|
| Hosts file | `0.0.0.0 ads.example.com` | Lấy token thứ 2 sau whitespace |
| AdBlock Plus | `\|\|ads.example.com^` | Bỏ `\|\|` prefix và `^` suffix |
| Plain domain | `tracker.com` | Dùng trực tiếp |

Domain được lowercase, bỏ comment (`#`, `!`, `@@`) trước khi add vào Trie.

**Cách Trie lưu trữ:**
```
"ads.google.com" → labels reversed → com → google → ads
"sub.ads.google.com" → com → google → ads → sub
```
Labels dùng chung prefix → tiết kiệm 60–70% memory so với HashSet.

---

### Bước 2 – Serialize Trie ra file `.trie`

**File:** [`DomainTrie.kt#saveToBinary()`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/DomainTrie.kt#L238-L292)

**Thuật toán: 2-pass BFS**

**Pass 1** – Tính byte offset cho mỗi node:
```kotlin
queue.add(root); var offset = 16 // header
while (queue.isNotEmpty()) {
    val node = queue.removeFirst()
    node.bfsOffset = offset
    offset += 3 // isTerminal(1) + childCount(2)
    node.children?.forEach { (label, child) ->
        offset += 2 + label.utf8Size + 4  // labelLen + label + childOffset
        queue.add(child)
    }
}
```

**Pass 2** – Ghi bytes (big-endian):
```kotlin
out.writeInt(MAGIC)    // 0x54524945 = "TRIE"
out.writeInt(VERSION)  // 1
out.writeInt(nodeCount)
out.writeInt(domainCount)
// Sau đó từng node theo BFS order:
// isTerminal(1 byte) + childCount(2 bytes)
// + [labelLen(2) + label(N bytes) + childOffset(4)]×childCount
```

**Định dạng binary của `.trie`:**
```
┌─────────────────────────────────────────────────┐
│ HEADER (16 bytes, big-endian)                   │
│   magic(4)   version(4)   nodeCount(4)  domainCount(4) │
├─────────────────────────────────────────────────┤
│ NODE 0 (root, tại offset 16)                    │
│   isTerminal(1)  childCount(2)                  │
│   child[0]: labelLen(2) label(N) childOffset(4) │
│   child[1]: ...                                 │
├─────────────────────────────────────────────────┤
│ NODE 1 (tại offset được ghi trong childOffset)  │
│   ...                                           │
└─────────────────────────────────────────────────┘
```

> [!NOTE]
> Nodes được ghi theo **BFS order** nhưng truy cập theo **offset pointer** → Go có thể jump trực tiếp đến node bất kỳ khi duyệt cây.

---

### Bước 3 – Build Bloom Filter và serialize ra `.bloom`

**File:** [`DomainTrie.kt#saveBloomFilter()`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/DomainTrie.kt#L302-L327), [`BloomFilterBuilder`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/DomainTrie.kt#L337-L410)

**Tính toán tham số tối ưu (FPR = 0.1%):**
```
m = -(n × ln(0.001)) / (ln 2)²   → số bit tối ưu
k = (m / n) × ln 2               → số hàm hash tối ưu
```

**Hàm hash: FNV Double Hashing**

Kotlin và Go **phải dùng cùng một thuật toán** để kết quả khớp nhau:

```kotlin
// Kotlin (BloomFilterBuilder.kt)
// h1: FNV-1a (XOR-then-multiply)
var h1 = FNV_OFFSET_BASIS  // 14695981039346656037uL
for (b in bytes) { h1 = h1 xor b.toUByte().toULong(); h1 *= FNV_PRIME }

// h2: FNV-1 (multiply-then-XOR)  
var h2 = FNV_OFFSET_BASIS
for (b in bytes) { h2 *= FNV_PRIME; h2 = h2 xor b.toUByte().toULong() }
if (h2 % 2uL == 0uL) h2++  // Đảm bảo h2 là số lẻ
```

```go
// Go (bloom.go)
h1 := fnv.New64a(); h1.Write([]byte(s))  // FNV-1a
h2 := fnv.New64();  h2.Write([]byte(s))  // FNV-1
if v2%2 == 0 { v2++ }                    // Đảm bảo h2 lẻ
```

**Cách thêm domain vào bloom:**
```kotlin
fun add(domain: String) {
    val (h1, h2) = fnvDoubleHash(domain)
    for (i in 0 until hashCount) {
        val idx = (h1 + i × h2) % bitCount
        bits[idx/8] = bits[idx/8] or (1 shl (idx%8))
    }
}
```

**Định dạng binary của `.bloom`:**
```
┌──────────────────────────────────────────────────┐
│ HEADER (24 bytes, big-endian)                    │
│   magic(4)=0x424C4F4D   version(4)=1             │
│   bitCount(8)           hashCount(4)  padding(4) │
├──────────────────────────────────────────────────┤
│ BIT ARRAY                                        │
│   (bitCount / 8) bytes, little-endian bit order  │
└──────────────────────────────────────────────────┘
```

---

## Ba chiến lược Build (FilterListRepository)

**File:** [`FilterListRepository.kt#loadAllEnabledFilters()`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/FilterListRepository.kt#L456-L663)

```
┌─ fingerprint unchanged? ───────────────────────────────────────────┐
│  YES → Strategy 1: Cache HIT                                       │
│         mmap existing .trie + .bloom (~50ms, zero re-parse)        │
│                                                                    │
│  NO  ─┬─ only new filters added? ──────────────────────────────────┤
│       │  YES → Strategy 2: Incremental ADD                         │
│       │         load binary Trie → add new domains → re-serialize  │
│       │                                                            │
│       └─ filters removed/changed? ─────────────────────────────────┘
│          YES → Strategy 3: Full REBUILD
│                 fresh DomainTrie → parse all → saveToBinary
│                                             → saveBloomFilter
```

**Fingerprint** được tính từ: `filterID:cacheFile.lastModified()` của tất cả enabled lists.

---

## Runtime: Go Engine nạp file

**File:** [`engine.go#SetTries()`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/tunnel/engine.go#L144-L211), [`GoTunnelAdapter.kt#updateTries()`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/service/GoTunnelAdapter.kt#L252-L259)

```kotlin
// Kotlin truyền đường dẫn file sang Go
engine.setTries(
    filterRepo.getAdTriePath() ?: "",       // .../trie_cache/ad_domains.trie
    filterRepo.getSecurityTriePath() ?: "", // .../trie_cache/security_domains.trie
    filterRepo.getAdBloomPath() ?: "",      // .../trie_cache/ad_domains.bloom
    filterRepo.getSecurityBloomPath() ?: "" // .../trie_cache/security_domains.bloom
)
```

Go mmap toàn bộ file vào memory (read-only, shared):
```go
data, _ := unix.Mmap(int(f.Fd()), 0, int(size), unix.PROT_READ, unix.MAP_SHARED)
```

---

## Luồng tra cứu tại runtime (handleDNSQuery)

**File:** [`engine.go#handleDNSQuery()`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/tunnel/engine.go#L628-L717)

```
DNS Query cho domain X
│
├── 1. Custom Rule (Kotlin callback HasCustomRule)
│       0=allow → forward   1=block → block  -1=không có
│
├── 2. Security Bloom Filter (O(1))
│       "definitely not" → skip Trie
│       "maybe" → Security Trie (O(label_count)) → block nếu match
│
├── 3. Ad Bloom Filter (O(1))
│       "definitely not" → skip Trie  ← ~90% clean domains kết thúc ở đây!
│       "maybe" → Ad Trie (O(label_count)) → block nếu match
│
└── 4. Forward lên upstream DNS
```

> [!TIP]
> Bloom Filter đặt trước Trie là **key optimization**: với FPR 0.1%, ~99.9% domain sạch không bao giờ chạm đến Trie traversal.

---

## Vị trí file trên thiết bị

```
/data/data/app.pwhs.blockads/files/
├── trie_cache/
│   ├── ad_domains.trie          ← Binary Trie (ad blocklists)
│   ├── ad_domains.bloom         ← Bloom Filter (ad)
│   ├── security_domains.trie    ← Binary Trie (malware/phishing)
│   ├── security_domains.bloom   ← Bloom Filter (security)
│   └── trie_fingerprint.txt     ← Cache invalidation key
└── filter_cache/
    └── <hash>.txt               ← Raw downloaded filter list files
```

---

## Tóm tắt các file liên quan

| File | Vai trò |
|------|---------|
| [`DomainTrie.kt`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/DomainTrie.kt) | Build + serialize Trie, build Bloom Filter (Kotlin) |
| [`FilterListRepository.kt`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/data/repository/FilterListRepository.kt) | Điều phối: download, parse, quyết định strategy |
| [`GoTunnelAdapter.kt`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/app/src/main/java/app/pwhs/blockads/service/GoTunnelAdapter.kt) | Truyền đường dẫn file sang Go engine |
| [`trie.go`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/tunnel/trie.go) | Load + mmap Trie, tra cứu domain (Go) |
| [`bloom.go`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/tunnel/bloom.go) | Load + mmap Bloom Filter, pre-filter (Go) |
| [`engine.go`](file:///Users/nqmgaming/AndroidStudioProjects/blockads-android/tunnel/engine.go) | DNS query pipeline: Bloom → Trie → forward |
