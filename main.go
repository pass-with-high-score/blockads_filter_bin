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
	"sort"
	"strings"
	"sync"
	"time"
)

// ────────────────────────────────────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────────────────────────────────────

const GitHubRawBase = "https://raw.githubusercontent.com/pass-with-high-score/blockads_filter_bin/refs/heads/main/output"

// FilterEntry represents a single filter list to download and process.
type FilterEntry struct {
	Name        string `json:"name"`
	ID          string `json:"id"`
	URL         string `json:"url"`
	Description string `json:"description"`
	IsEnabled   bool   `json:"isEnabled"`
	IsBuiltIn   bool   `json:"isBuiltIn"`
	Category    string `json:"category"`
}

// ManifestEntry represents the generated output information for a filter list.
type ManifestEntry struct {
	Name        string `json:"name"`
	ID          string `json:"id"`
	Description string `json:"description"`
	IsEnabled   bool   `json:"isEnabled"`
	IsBuiltIn   bool   `json:"isBuiltIn"`
	Category    string `json:"category"`
	RuleCount   int    `json:"ruleCount"`
	BloomURL    string `json:"bloomUrl,omitempty"`
	TrieURL     string `json:"trieUrl,omitempty"`
	CssURL      string `json:"cssUrl,omitempty"`
	OriginalURL string `json:"originalUrl"`
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
		entries = append(entries, FilterEntry{Name: name, ID: name, URL: line})
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

// containsLetterOrDigit checks if a string contains at least one letter or digit.
func containsLetterOrDigit(s string) bool {
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return true
		}
	}
	return false
}

// downloadAndParseDomains returns unique domains and cosmetic CSS rules.
// It streams the response line-by-line using bufio.Scanner for memory efficiency.
func downloadAndParseDomains(url string) ([]string, []string, error) {
	client := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		return nil, nil, fmt.Errorf("HTTP GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	// Use sets to deduplicate
	seenDomains := make(map[string]struct{})
	seenCSS := make(map[string]struct{})
	var domains []string
	var cssRules []string

	scanner := bufio.NewScanner(resp.Body)
	// Increase buffer size for very long lines (some filter lists have them)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	const maxCSSRules = 2000
	// Note: To match the Kotlin implementation, we just extract the matching selectors here
	// and we will format them into minified CSS during the processEntry step.
	for scanner.Scan() {
		rawLine := strings.TrimSpace(scanner.Text())

		// Skip obvious comments
		if (strings.HasPrefix(rawLine, "! ") || strings.HasPrefix(rawLine, "# ")) && !strings.Contains(rawLine, "##") {
			continue
		}

		// 1. Extract CSS Rules
		if strings.Contains(rawLine, "##") &&
			!strings.Contains(rawLine, "#@#") &&
			!strings.Contains(rawLine, "##+js") &&
			!strings.Contains(rawLine, "##^") {

			idx := strings.Index(rawLine, "##")
			if idx >= 0 {
				prefix := rawLine[:idx]
				selector := strings.TrimSpace(rawLine[idx+2:])

				// V1: Only generic rules (no domain prefix)
				if prefix == "" && selector != "" {
					// Validate selector
					isValid := true
					if strings.HasPrefix(selector, "+") || strings.HasPrefix(selector, "^") {
						// Invalid start
						isValid = false
					} else if strings.Contains(selector, " ") {
						// Exclude selectors with unescaped spaces
						isValid = false
					} else if !containsLetterOrDigit(selector) {
						// Exclude comment separators that slipped through like `###############`
						isValid = false
					} else if strings.Contains(selector, "url(") || strings.Contains(selector, "expression(") {
						// Avoid potentially dangerous content
						isValid = false
					}

					if isValid {
						if _, exists := seenCSS[selector]; !exists {
							seenCSS[selector] = struct{}{}
							if len(cssRules) < maxCSSRules {
								cssRules = append(cssRules, selector)
							}
						}
					}
				}
			}
		}

		// 2. Extract Domains
		domain := parseDomainLine(rawLine)
		if domain == "" {
			continue
		}
		if _, exists := seenDomains[domain]; !exists {
			seenDomains[domain] = struct{}{}
			domains = append(domains, domain)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, nil, fmt.Errorf("scanning response from %s: %w", url, err)
	}

	return domains, cssRules, nil
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
//   magic(4)=0x54524945  version(4)=2  nodeCount(4)  domainCount(4)
//
// Each NODE in BFS order:
//   isTerminal(1 byte)  childCount(4 bytes, big-endian)
//   For each child:
//     labelLen(2 bytes, big-endian)  label(N bytes UTF-8)  childOffset(4 bytes, big-endian)

const (
	trieMagic   = 0x54524945 // "TRIE"
	trieVersion = 2
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

		// isTerminal(1) + childCount(4)
		offset += 5

		var labels []string
		for label := range node.Children {
			labels = append(labels, label)
		}
		sort.Strings(labels)

		for _, label := range labels {
			child := node.Children[label]
			offset += 2 + len(label) + 4
			queue = append(queue, child)
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

		// childCount (4 bytes, big-endian)
		var buf [4]byte
		binary.BigEndian.PutUint32(buf[0:4], uint32(len(node.Children)))
		if _, err := w.Write(buf[0:4]); err != nil {
			return err
		}

		var labels []string
		for label := range node.Children {
			labels = append(labels, label)
		}
		sort.Strings(labels)

		// For each child: labelLen(2) + label(N bytes) + childOffset(4)
		for _, label := range labels {
			child := node.Children[label]
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

// processEntry downloads a filter list, parses domains and CSS rules,
// builds the Trie and Bloom Filter, and serializes them to the output directory.
func processEntry(entry FilterEntry, outputDir string) (*ManifestEntry, error) {
	startTime := time.Now()
	log.Printf("[%s] ▶ Starting download: %s", entry.Name, entry.URL)

	manifest := &ManifestEntry{
		Name:        entry.Name,
		ID:          entry.ID,
		Description: entry.Description,
		IsEnabled:   entry.IsEnabled,
		IsBuiltIn:   entry.IsBuiltIn,
		Category:    entry.Category,
		OriginalURL: entry.URL,
	}

	// Use ID as the filename prefix, fallback to deriving from URL if missing
	prefix := entry.ID
	if prefix == "" {
		prefix = deriveNameFromURL(entry.URL)
		manifest.ID = prefix
	}

	// Step 1: Download and parse domains and CSS
	domains, cssRules, err := downloadAndParseDomains(entry.URL)
	if err != nil {
		return nil, fmt.Errorf("[%s] download failed: %w", entry.Name, err)
	}
	downloadDuration := time.Since(startTime)
	log.Printf("[%s] ✓ Downloaded and parsed %d domains, %d CSS rules (%.2fs)",
		entry.Name, len(domains), len(cssRules), downloadDuration.Seconds())

	if len(domains) == 0 && len(cssRules) == 0 {
		log.Printf("[%s] ⚠ No domains or CSS rules found, skipping", entry.Name)
		return nil, nil
	}

	manifest.RuleCount = len(domains)

	// Step 2: Build Trie (only if we have domains)
	var trieBuildDuration time.Duration
	var root *TrieNode
	if len(domains) > 0 {
		trieStart := time.Now()
		root = NewTrieNode()
		for _, domain := range domains {
			root.Insert(domain)
		}
		trieBuildDuration = time.Since(trieStart)
		log.Printf("[%s] ✓ Trie built: %d nodes, %d terminals (%.2fs)",
			entry.Name, root.countNodes(), root.countTerminals(), trieBuildDuration.Seconds())
	}

	// Step 3: Build Bloom Filter (only if we have domains)
	var bloomBuildDuration time.Duration
	var bf *BloomFilter
	if len(domains) > 0 {
		bloomStart := time.Now()
		bf = NewBloomFilter(len(domains))
		for _, domain := range domains {
			bf.Add(domain)
		}
		bloomBuildDuration = time.Since(bloomStart)
		log.Printf("[%s] ✓ Bloom Filter built: %d bits, %d hash functions, FPR=0.1%% (%.2fs)",
			entry.Name, bf.bitCount, bf.hashCount, bloomBuildDuration.Seconds())
	}

	serializeStart := time.Now()

	// Step 4: Serialize Trie to .trie file
	if len(domains) > 0 {
		triePath := filepath.Join(outputDir, prefix+".trie")
		if err := SerializeTrie(root, triePath); err != nil {
			return nil, fmt.Errorf("[%s] trie serialization failed: %w", entry.Name, err)
		}
		trieFileInfo, _ := os.Stat(triePath)
		manifest.TrieURL = fmt.Sprintf("%s/%s.trie", GitHubRawBase, prefix)
		log.Printf("[%s] ✓ Saved %s (%s)", entry.Name, triePath, formatBytes(trieFileInfo.Size()))
	}

	// Step 5: Serialize Bloom Filter to .bloom file
	if len(domains) > 0 {
		bloomPath := filepath.Join(outputDir, prefix+".bloom")
		if err := bf.Serialize(bloomPath); err != nil {
			return nil, fmt.Errorf("[%s] bloom serialization failed: %w", entry.Name, err)
		}
		bloomFileInfo, _ := os.Stat(bloomPath)
		manifest.BloomURL = fmt.Sprintf("%s/%s.bloom", GitHubRawBase, prefix)
		log.Printf("[%s] ✓ Saved %s (%s)", entry.Name, bloomPath, formatBytes(bloomFileInfo.Size()))
	}

	// Step 6: Save CSS rules to .css file
	if len(cssRules) > 0 {
		cssPath := filepath.Join(outputDir, prefix+".css")
		cssFile, err := os.Create(cssPath)
		if err != nil {
			return nil, fmt.Errorf("[%s] creating css file failed: %w", entry.Name, err)
		}

		cssWriter := bufio.NewWriter(cssFile)

		// Write each extracted selector on a new line
		for _, rule := range cssRules {
			if _, err := cssWriter.WriteString(rule + "\n"); err != nil {
				cssFile.Close() // best effort close on error
				return nil, fmt.Errorf("[%s] writing css rule failed: %w", entry.Name, err)
			}
		}

		if err := cssWriter.Flush(); err != nil {
			cssFile.Close()
			return nil, fmt.Errorf("[%s] flushing css rules failed: %w", entry.Name, err)
		}
		cssFile.Close()

		cssFileInfo, _ := os.Stat(cssPath)
		manifest.CssURL = fmt.Sprintf("%s/%s.css", GitHubRawBase, prefix)
		log.Printf("[%s] ✓ Saved %s (%s)", entry.Name, cssPath, formatBytes(cssFileInfo.Size()))
	}

	serializeDuration := time.Since(serializeStart)
	totalDuration := time.Since(startTime)
	log.Printf("[%s] ✅ Finished in %.2fs (download: %.2fs, trie: %.2fs, bloom: %.2fs, serialize: %.2fs)",
		entry.Name, totalDuration.Seconds(),
		downloadDuration.Seconds(), trieBuildDuration.Seconds(),
		bloomBuildDuration.Seconds(), serializeDuration.Seconds())

	return manifest, nil
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

	type resultData struct {
		manifest *ManifestEntry
		err      error
	}
	resultsCh := make(chan resultData, len(entries))

	for _, entry := range entries {
		wg.Add(1)
		go func(e FilterEntry) {
			defer wg.Done()
			sem <- struct{}{}        // acquire semaphore slot
			defer func() { <-sem }() // release slot

			manifest, err := processEntry(e, *outputDir)
			if err != nil {
				log.Printf("✗ ERROR: %v", err)
			}
			resultsCh <- resultData{manifest: manifest, err: err}
		}(entry)
	}

	wg.Wait()
	close(resultsCh)

	// Report results and gather manifests
	var errors []error
	var manifests []*ManifestEntry

	for res := range resultsCh {
		if res.err != nil {
			errors = append(errors, res.err)
		} else if res.manifest != nil {
			manifests = append(manifests, res.manifest)
		}
	}

	// Write manifest JSON
	manifestPath := filepath.Join(*outputDir, "filter_lists.json")
	manifestFile, err := os.Create(manifestPath)
	if err == nil {
		encoder := json.NewEncoder(manifestFile)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(manifests); err == nil {
			log.Printf("✓ Generated manifest: %s", manifestPath)
		} else {
			log.Printf("✗ Failed to write manifest JSON: %v", err)
		}
		manifestFile.Close()
	} else {
		log.Printf("✗ Failed to create manifest file: %v", err)
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
