// Package main implements a CLI tool that downloads ad-blocking filter lists,
// parses domains from various formats, builds Trie and Bloom Filter data
// structures, and serializes them into binary files compatible with the
// BlockAds Android Go engine (mmap-friendly, custom binary format).
//
// Usage:
//
//	go run main.go                     # uses config.json in current dir
//	go run main.go -config lists.json  # uses a custom JSON config
//	go run main.go -urls filter.txt    # reads plain URLs, one per line
//	go run main.go -output builds/     # custom output directory
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

// FilterEntry represents a single filter list to download and process.
type FilterEntry struct {
	Name string `json:"name"` // Output file prefix (e.g. "oisd_big")
	URL  string `json:"url"`  // URL to the raw filter text file
}

// loadConfigJSON reads a JSON config file containing an array of FilterEntry.
func loadConfigJSON(path string) ([]FilterEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config %s: %w", path, err)
	}
	var entries []FilterEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("parsing config %s: %w", path, err)
	}
	return entries, nil
}

// loadPlainURLs reads a plain text file with one URL per line and derives
// names from the URL path (last segment without extension).
func loadPlainURLs(path string) ([]FilterEntry, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("opening URL list %s: %w", path, err)
	}
	defer f.Close()

	var entries []FilterEntry
	scanner := bufio.NewScanner(f)
	seen := make(map[string]int) // track duplicate names

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name := deriveNameFromURL(line)
		// Ensure unique names by appending a counter for duplicates
		seen[name]++
		if seen[name] > 1 {
			name = fmt.Sprintf("%s_%d", name, seen[name])
		}
		entries = append(entries, FilterEntry{Name: name, URL: line})
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading URL list %s: %w", path, err)
	}
	return entries, nil
}

// deriveNameFromURL extracts a clean file name from a URL path.
func deriveNameFromURL(rawURL string) string {
	// Remove query string
	u := rawURL
	if idx := strings.Index(u, "?"); idx != -1 {
		u = u[:idx]
	}
	// Get last path segment
	parts := strings.Split(strings.TrimRight(u, "/"), "/")
	base := parts[len(parts)-1]
	// Remove common extensions
	for _, ext := range []string{".txt", ".csv", ".hosts", ".list"} {
		base = strings.TrimSuffix(base, ext)
	}
	// Replace unsafe filename chars
	replacer := strings.NewReplacer(".", "_", "-", "_", " ", "_")
	name := replacer.Replace(base)
	if name == "" {
		name = "filter"
	}
	return strings.ToLower(name)
}

// ────────────────────────────────────────────────────────────────────────────
// Domain Parser
// ────────────────────────────────────────────────────────────────────────────

// parseDomainLine extracts a domain from a single line of a filter list.
// It handles hosts-file format, AdBlock Plus format, and plain domains.
// Returns empty string if the line should be skipped.
func parseDomainLine(line string) string {
	line = strings.TrimSpace(line)

	// Skip empty lines and comments
	if line == "" {
		return ""
	}
	if line[0] == '#' || line[0] == '!' {
		return ""
	}
	// Skip AdBlock exception rules
	if strings.HasPrefix(line, "@@") {
		return ""
	}
	// Skip lines that look like complex AdBlock rules (contain $, /, etc.)
	// but are not domain-only rules
	if strings.ContainsAny(line, "$/\\*") && !strings.HasPrefix(line, "||") {
		return ""
	}

	var domain string

	switch {
	// AdBlock Plus domain-only rule: ||domain.com^
	case strings.HasPrefix(line, "||"):
		domain = strings.TrimPrefix(line, "||")
		// Remove trailing ^ and anything after it
		if idx := strings.IndexByte(domain, '^'); idx != -1 {
			domain = domain[:idx]
		}
		// If there's still a $ (modifier), take only the domain part
		if idx := strings.IndexByte(domain, '$'); idx != -1 {
			domain = domain[:idx]
		}

	// Hosts file format: 0.0.0.0 domain.com or 127.0.0.1 domain.com
	case strings.HasPrefix(line, "0.0.0.0 ") ||
		strings.HasPrefix(line, "0.0.0.0\t") ||
		strings.HasPrefix(line, "127.0.0.1 ") ||
		strings.HasPrefix(line, "127.0.0.1\t"):
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			domain = fields[1]
		}
		// Remove inline comment
		if idx := strings.IndexByte(domain, '#'); idx != -1 {
			domain = domain[:idx]
		}

	default:
		// Plain domain (one word, no spaces, contains at least one dot)
		if !strings.ContainsAny(line, " \t") && strings.Contains(line, ".") {
			domain = line
		}
	}

	// Validate and clean the domain
	domain = strings.ToLower(strings.TrimSpace(domain))
	if domain == "" || domain == "localhost" || domain == "localhost.localdomain" ||
		domain == "broadcasthost" || domain == "local" {
		return ""
	}
	// Basic domain validation: must contain a dot and only valid chars
	if !strings.Contains(domain, ".") {
		return ""
	}
	// Reject IPs (start with digit and all segments are numbers)
	if domain[0] >= '0' && domain[0] <= '9' {
		allDigitsOrDots := true
		for _, c := range domain {
			if c != '.' && (c < '0' || c > '9') {
				allDigitsOrDots = false
				break
			}
		}
		if allDigitsOrDots {
			return ""
		}
	}

	return domain
}

// downloadAndParseDomains downloads a filter list from url and returns unique domains.
// It streams the response line-by-line using bufio.Scanner for memory efficiency.
func downloadAndParseDomains(url string) ([]string, error) {
	client := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("HTTP GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	// Use a set to deduplicate domains
	seen := make(map[string]struct{})
	var domains []string

	scanner := bufio.NewScanner(resp.Body)
	// Increase buffer size for very long lines (some filter lists have them)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		domain := parseDomainLine(scanner.Text())
		if domain == "" {
			continue
		}
		if _, exists := seen[domain]; !exists {
			seen[domain] = struct{}{}
			domains = append(domains, domain)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scanning response from %s: %w", url, err)
	}

	return domains, nil
}

// ────────────────────────────────────────────────────────────────────────────
// Trie Data Structure
// ────────────────────────────────────────────────────────────────────────────

// TrieNode represents a node in the domain Trie tree.
// Domains are stored with reversed labels for efficient subdomain matching.
// For example, "ads.google.com" is stored as com → google → ads.
type TrieNode struct {
	Children   map[string]*TrieNode // label → child node
	IsTerminal bool                 // true if this node marks the end of a blocked domain
	bfsOffset  int                  // byte offset used during BFS serialization
}

// NewTrieNode creates a new empty TrieNode.
func NewTrieNode() *TrieNode {
	return &TrieNode{
		Children: make(map[string]*TrieNode),
	}
}

// Insert adds a domain to the Trie with reversed labels.
// "ads.google.com" → labels ["com", "google", "ads"]
func (t *TrieNode) Insert(domain string) {
	labels := strings.Split(domain, ".")
	node := t
	// Insert labels in reverse order (TLD first)
	for i := len(labels) - 1; i >= 0; i-- {
		label := labels[i]
		if label == "" {
			continue
		}
		child, exists := node.Children[label]
		if !exists {
			child = NewTrieNode()
			node.Children[label] = child
		}
		node = child
	}
	node.IsTerminal = true
}

// countNodes returns the total number of nodes in the Trie (including root).
func (t *TrieNode) countNodes() int {
	count := 1
	for _, child := range t.Children {
		count += child.countNodes()
	}
	return count
}

// countTerminals returns the number of terminal (domain-end) nodes.
func (t *TrieNode) countTerminals() int {
	count := 0
	if t.IsTerminal {
		count = 1
	}
	for _, child := range t.Children {
		count += child.countTerminals()
	}
	return count
}

// ────────────────────────────────────────────────────────────────────────────
// Trie Binary Serialization
// ────────────────────────────────────────────────────────────────────────────
//
// Binary format matches bloom_trie_build_doc.md exactly:
//
// HEADER (16 bytes, big-endian):
//   magic(4)=0x54524945  version(4)=1  nodeCount(4)  domainCount(4)
//
// Each NODE in BFS order:
//   isTerminal(1 byte)  childCount(2 bytes, big-endian)
//   For each child:
//     labelLen(2 bytes, big-endian)  label(N bytes UTF-8)  childOffset(4 bytes, big-endian)

const (
	trieMagic   = 0x54524945 // "TRIE"
	trieVersion = 1
)

// SerializeTrie writes the Trie to a binary file in the format compatible
// with the BlockAds Go engine (mmap-friendly, big-endian).
// Uses a 2-pass BFS algorithm:
//
//	Pass 1: Calculate byte offsets for each node.
//	Pass 2: Write the actual bytes.
func SerializeTrie(root *TrieNode, path string) error {
	nodeCount := root.countNodes()
	domainCount := root.countTerminals()

	// ── Pass 1: Calculate byte offsets ──
	type queueItem struct {
		node *TrieNode
	}
	queue := []*TrieNode{root}
	offset := 16 // start after header

	for i := 0; i < len(queue); i++ {
		node := queue[i]
		node.bfsOffset = offset

		// isTerminal(1) + childCount(2)
		offset += 3

		// For each child: labelLen(2) + label(N) + childOffset(4)
		for label, child := range node.Children {
			offset += 2 + utf8Len(label) + 4
			queue = append(queue, child)
			_ = child // enqueue
		}
	}

	// ── Pass 2: Write bytes ──
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("creating trie file %s: %w", path, err)
	}
	defer f.Close()

	w := bufio.NewWriter(f)

	// Write header (16 bytes, big-endian)
	hdr := make([]byte, 16)
	binary.BigEndian.PutUint32(hdr[0:4], trieMagic)
	binary.BigEndian.PutUint32(hdr[4:8], trieVersion)
	binary.BigEndian.PutUint32(hdr[8:12], uint32(nodeCount))
	binary.BigEndian.PutUint32(hdr[12:16], uint32(domainCount))
	if _, err := w.Write(hdr); err != nil {
		return err
	}

	// Write nodes in BFS order
	for _, node := range queue {
		// isTerminal (1 byte)
		if node.IsTerminal {
			if err := w.WriteByte(1); err != nil {
				return err
			}
		} else {
			if err := w.WriteByte(0); err != nil {
				return err
			}
		}

		// childCount (2 bytes, big-endian)
		var buf [4]byte
		binary.BigEndian.PutUint16(buf[0:2], uint16(len(node.Children)))
		if _, err := w.Write(buf[0:2]); err != nil {
			return err
		}

		// For each child: labelLen(2) + label(N bytes) + childOffset(4)
		for label, child := range node.Children {
			labelBytes := []byte(label)

			// labelLen (2 bytes)
			binary.BigEndian.PutUint16(buf[0:2], uint16(len(labelBytes)))
			if _, err := w.Write(buf[0:2]); err != nil {
				return err
			}

			// label (N bytes)
			if _, err := w.Write(labelBytes); err != nil {
				return err
			}

			// childOffset (4 bytes)
			binary.BigEndian.PutUint32(buf[0:4], uint32(child.bfsOffset))
			if _, err := w.Write(buf[0:4]); err != nil {
				return err
			}
		}
	}

	return w.Flush()
}

// utf8Len returns the byte length of a string when encoded as UTF-8.
// In Go, len(s) already returns the byte count of the UTF-8 string.
func utf8Len(s string) int {
	return len(s)
}

// ────────────────────────────────────────────────────────────────────────────
// Bloom Filter
// ────────────────────────────────────────────────────────────────────────────
//
// Implements a Bloom Filter using FNV-1a + FNV-1 double hashing, identical
// to the Kotlin BloomFilterBuilder and Go bloom.go in the Android app.
//
// Binary format matches bloom_trie_build_doc.md:
//
// HEADER (24 bytes, big-endian):
//   magic(4)=0x424C4F4D  version(4)=1  bitCount(8)  hashCount(4)  padding(4)
//
// BIT ARRAY:
//   (bitCount / 8) bytes, little-endian bit order

const (
	bloomMagic   = 0x424C4F4D // "BLOM"
	bloomVersion = 1
	bloomFPR     = 0.001 // False positive rate: 0.1%
)

// BloomFilter is a space-efficient probabilistic data structure.
type BloomFilter struct {
	bits      []byte // bit array
	bitCount  uint64 // total number of bits
	hashCount uint32 // number of hash functions (k)
}

// NewBloomFilter creates a new Bloom Filter optimized for n elements
// with a false positive rate of 0.1%.
func NewBloomFilter(n int) *BloomFilter {
	if n <= 0 {
		n = 1
	}

	// Calculate optimal parameters
	// m = -(n × ln(FPR)) / (ln2)²
	ln2 := math.Ln2
	m := uint64(math.Ceil(-float64(n) * math.Log(bloomFPR) / (ln2 * ln2)))

	// Round up to nearest multiple of 8
	m = ((m + 7) / 8) * 8

	// k = (m / n) × ln2
	k := uint32(math.Round(float64(m) / float64(n) * ln2))
	if k < 1 {
		k = 1
	}

	return &BloomFilter{
		bits:      make([]byte, m/8),
		bitCount:  m,
		hashCount: k,
	}
}

// fnvDoubleHash computes FNV-1a (h1) and FNV-1 (h2) hashes for a string.
// This matches the Kotlin BloomFilterBuilder and Go bloom.go exactly.
func fnvDoubleHash(s string) (uint64, uint64) {
	data := []byte(s)

	// h1: FNV-1a (XOR-then-multiply)
	h1 := fnv.New64a()
	h1.Write(data)
	v1 := h1.Sum64()

	// h2: FNV-1 (multiply-then-XOR)
	h2 := fnv.New64()
	h2.Write(data)
	v2 := h2.Sum64()

	// Ensure h2 is odd (for better distribution across bit positions)
	if v2%2 == 0 {
		v2++
	}

	return v1, v2
}

// Add inserts a domain into the Bloom Filter.
func (bf *BloomFilter) Add(domain string) {
	h1, h2 := fnvDoubleHash(domain)
	for i := uint32(0); i < bf.hashCount; i++ {
		idx := (h1 + uint64(i)*h2) % bf.bitCount
		bf.bits[idx/8] |= 1 << (idx % 8) // little-endian bit order
	}
}

// SerializeBloom writes the Bloom Filter to a binary file.
func (bf *BloomFilter) Serialize(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("creating bloom file %s: %w", path, err)
	}
	defer f.Close()

	w := bufio.NewWriter(f)

	// Write header (24 bytes, big-endian)
	hdr := make([]byte, 24)
	binary.BigEndian.PutUint32(hdr[0:4], bloomMagic)
	binary.BigEndian.PutUint32(hdr[4:8], bloomVersion)
	binary.BigEndian.PutUint64(hdr[8:16], bf.bitCount)
	binary.BigEndian.PutUint32(hdr[16:20], bf.hashCount)
	// hdr[20:24] = padding (zeros)
	if _, err := w.Write(hdr); err != nil {
		return err
	}

	// Write bit array
	if _, err := w.Write(bf.bits); err != nil {
		return err
	}

	return w.Flush()
}

// ────────────────────────────────────────────────────────────────────────────
// Processing Pipeline
// ────────────────────────────────────────────────────────────────────────────

// processEntry downloads a filter list, parses domains, builds the Trie and
// Bloom Filter, and serializes them to the output directory.
func processEntry(entry FilterEntry, outputDir string) error {
	startTime := time.Now()
	log.Printf("[%s] ▶ Starting download: %s", entry.Name, entry.URL)

	// Step 1: Download and parse domains
	domains, err := downloadAndParseDomains(entry.URL)
	if err != nil {
		return fmt.Errorf("[%s] download failed: %w", entry.Name, err)
	}
	downloadDuration := time.Since(startTime)
	log.Printf("[%s] ✓ Downloaded and parsed %d unique domains (%.2fs)",
		entry.Name, len(domains), downloadDuration.Seconds())

	if len(domains) == 0 {
		log.Printf("[%s] ⚠ No domains found, skipping", entry.Name)
		return nil
	}

	// Step 2: Build Trie
	trieStart := time.Now()
	root := NewTrieNode()
	for _, domain := range domains {
		root.Insert(domain)
	}
	trieBuildDuration := time.Since(trieStart)
	log.Printf("[%s] ✓ Trie built: %d nodes, %d terminals (%.2fs)",
		entry.Name, root.countNodes(), root.countTerminals(), trieBuildDuration.Seconds())

	// Step 3: Build Bloom Filter
	bloomStart := time.Now()
	bf := NewBloomFilter(len(domains))
	for _, domain := range domains {
		bf.Add(domain)
	}
	bloomBuildDuration := time.Since(bloomStart)
	log.Printf("[%s] ✓ Bloom Filter built: %d bits, %d hash functions, FPR=0.1%% (%.2fs)",
		entry.Name, bf.bitCount, bf.hashCount, bloomBuildDuration.Seconds())

	// Step 4: Serialize Trie to .trie file
	triePath := filepath.Join(outputDir, entry.Name+".trie")
	serializeStart := time.Now()
	if err := SerializeTrie(root, triePath); err != nil {
		return fmt.Errorf("[%s] trie serialization failed: %w", entry.Name, err)
	}
	trieFileInfo, _ := os.Stat(triePath)
	log.Printf("[%s] ✓ Saved %s (%s)",
		entry.Name, triePath, formatBytes(trieFileInfo.Size()))

	// Step 5: Serialize Bloom Filter to .bloom file
	bloomPath := filepath.Join(outputDir, entry.Name+".bloom")
	if err := bf.Serialize(bloomPath); err != nil {
		return fmt.Errorf("[%s] bloom serialization failed: %w", entry.Name, err)
	}
	bloomFileInfo, _ := os.Stat(bloomPath)
	serializeDuration := time.Since(serializeStart)
	log.Printf("[%s] ✓ Saved %s (%s)",
		entry.Name, bloomPath, formatBytes(bloomFileInfo.Size()))

	totalDuration := time.Since(startTime)
	log.Printf("[%s] ✅ Finished in %.2fs (download: %.2fs, trie: %.2fs, bloom: %.2fs, serialize: %.2fs)",
		entry.Name, totalDuration.Seconds(),
		downloadDuration.Seconds(), trieBuildDuration.Seconds(),
		bloomBuildDuration.Seconds(), serializeDuration.Seconds())

	return nil
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

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

func main() {
	// Command-line flags
	configPath := flag.String("config", "config.json", "Path to JSON config file with filter list entries")
	urlsPath := flag.String("urls", "", "Path to plain text file with URLs (one per line), overrides -config")
	outputDir := flag.String("output", "output", "Output directory for .trie and .bloom files")
	maxConcurrent := flag.Int("concurrency", 4, "Maximum number of concurrent downloads")
	flag.Parse()

	log.SetFlags(log.Ltime | log.Lmicroseconds)
	log.Println("╔══════════════════════════════════════════════════════╗")
	log.Println("║   BlockAds Filter List Compiler                     ║")
	log.Println("║   Builds .trie and .bloom binary files              ║")
	log.Println("╚══════════════════════════════════════════════════════╝")

	// Load filter entries
	var entries []FilterEntry
	var err error

	if *urlsPath != "" {
		log.Printf("Loading URLs from: %s", *urlsPath)
		entries, err = loadPlainURLs(*urlsPath)
	} else {
		log.Printf("Loading config from: %s", *configPath)
		entries, err = loadConfigJSON(*configPath)
	}
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if len(entries) == 0 {
		log.Fatal("No filter entries found in config")
	}
	log.Printf("Loaded %d filter list entries", len(entries))

	// Create output directory
	if err := os.MkdirAll(*outputDir, 0755); err != nil {
		log.Fatalf("Failed to create output directory %s: %v", *outputDir, err)
	}

	// Process all entries concurrently with a semaphore to limit parallelism
	overallStart := time.Now()
	var wg sync.WaitGroup
	sem := make(chan struct{}, *maxConcurrent) // semaphore for concurrency limit
	errCh := make(chan error, len(entries))    // collect errors

	for _, entry := range entries {
		wg.Add(1)
		go func(e FilterEntry) {
			defer wg.Done()
			sem <- struct{}{}        // acquire semaphore slot
			defer func() { <-sem }() // release slot

			if err := processEntry(e, *outputDir); err != nil {
				log.Printf("✗ ERROR: %v", err)
				errCh <- err
			}
		}(entry)
	}

	wg.Wait()
	close(errCh)

	// Report results
	var errors []error
	for err := range errCh {
		errors = append(errors, err)
	}

	totalDuration := time.Since(overallStart)
	log.Println("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
	if len(errors) > 0 {
		log.Printf("⚠ Completed with %d error(s) out of %d lists (%.2fs)",
			len(errors), len(entries), totalDuration.Seconds())
		for i, err := range errors {
			log.Printf("  Error %d: %v", i+1, err)
		}
		os.Exit(1)
	} else {
		log.Printf("✅ All %d filter lists processed successfully in %.2fs",
			len(entries), totalDuration.Seconds())
		log.Printf("   Output directory: %s/", *outputDir)
	}
}
