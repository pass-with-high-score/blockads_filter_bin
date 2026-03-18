// Package compiler contains the core logic for downloading filter lists,
// parsing domains/CSS, building Trie and Bloom Filter data structures,
// and packaging them into a zip archive. It processes data line-by-line
// using bufio.Scanner to prevent OOM on large filter lists.
package compiler

import (
	"archive/zip"
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"blockads-filtering/internal/model"
)

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const (
	trieMagic    = 0x54524945 // "TRIE"
	trieVersion  = 1
	bloomMagic   = 0x424C4F4D // "BLOM"
	bloomVersion = 1
	bloomFPR     = 0.001 // False positive rate: 0.1%
	maxCSSRules  = 2000
)

// ────────────────────────────────────────────────────────────────────────────
// CompileResult holds the output of a full compilation pass.
// ────────────────────────────────────────────────────────────────────────────

// CompileResult contains all the compiled artifacts.
type CompileResult struct {
	ZipData   []byte // the final zip archive
	RuleCount int    // number of valid domain rules
	FileSize  int64  // size of the zip in bytes
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

// CompileFilterList downloads a filter list from the given URL, compiles it
// into .trie, .bloom, .css, and info.json, then packages everything into a
// zip archive returned as a byte slice. All processing is streaming/line-by-line.
func CompileFilterList(name, url string) (*CompileResult, error) {
	startTime := time.Now()
	log.Printf("[%s] ▶ Starting compilation: %s", name, url)

	// ── Step 1: Download and parse domains + CSS rules (streaming) ──
	domains, cssRules, err := downloadAndParseDomains(url)
	if err != nil {
		return nil, fmt.Errorf("download/parse failed: %w", err)
	}
	log.Printf("[%s] ✓ Parsed %d domains, %d CSS rules (%.2fs)",
		name, len(domains), len(cssRules), time.Since(startTime).Seconds())

	if len(domains) == 0 && len(cssRules) == 0 {
		return nil, fmt.Errorf("no domains or CSS rules found in filter list")
	}

	// ── Step 2: Build Trie ──
	var trieBytes []byte
	if len(domains) > 0 {
		root := NewTrieNode()
		for _, domain := range domains {
			root.Insert(domain)
		}
		trieBytes, err = serializeTrieToBytes(root)
		if err != nil {
			return nil, fmt.Errorf("trie serialization failed: %w", err)
		}
		log.Printf("[%s] ✓ Trie built: %d nodes (%s)",
			name, root.countNodes(), formatBytes(int64(len(trieBytes))))
	}

	// ── Step 3: Build Bloom Filter ──
	var bloomBytes []byte
	if len(domains) > 0 {
		bf := NewBloomFilter(len(domains))
		for _, domain := range domains {
			bf.Add(domain)
		}
		bloomBytes, err = bf.SerializeToBytes()
		if err != nil {
			return nil, fmt.Errorf("bloom serialization failed: %w", err)
		}
		log.Printf("[%s] ✓ Bloom Filter built: %d bits, %d hashes (%s)",
			name, bf.bitCount, bf.hashCount, formatBytes(int64(len(bloomBytes))))
	}

	// ── Step 4: Build CSS ──
	var cssBytes []byte
	if len(cssRules) > 0 {
		cssBytes = buildCSSFile(cssRules)
		log.Printf("[%s] ✓ CSS built: %d rules (%s)",
			name, len(cssRules), formatBytes(int64(len(cssBytes))))
	}

	// ── Step 5: Build info.json ──
	info := model.InfoJSON{
		Name:      name,
		URL:       url,
		RuleCount: len(domains),
		UpdatedAt: time.Now().UTC(),
	}
	infoBytes, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("info.json marshaling failed: %w", err)
	}

	// ── Step 6: Package into ZIP ──
	zipData, err := createZipArchive(name, trieBytes, bloomBytes, cssBytes, infoBytes)
	if err != nil {
		return nil, fmt.Errorf("zip creation failed: %w", err)
	}

	totalDuration := time.Since(startTime)
	log.Printf("[%s] ✅ Compilation complete: %d rules, %s zip (%.2fs)",
		name, len(domains), formatBytes(int64(len(zipData))), totalDuration.Seconds())

	return &CompileResult{
		ZipData:   zipData,
		RuleCount: len(domains),
		FileSize:  int64(len(zipData)),
	}, nil
}

// ────────────────────────────────────────────────────────────────────────────
// Domain Parser (streaming, line-by-line)
// ────────────────────────────────────────────────────────────────────────────

// downloadAndParseDomains streams a filter list and extracts unique domains
// and cosmetic CSS rules. Uses bufio.Scanner for memory efficiency.
func downloadAndParseDomains(url string) ([]string, []string, error) {
	client := &http.Client{Timeout: 90 * time.Second}

	resp, err := client.Get(url)
	if err != nil {
		return nil, nil, fmt.Errorf("HTTP GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	seenDomains := make(map[string]struct{})
	seenCSS := make(map[string]struct{})
	var domains []string
	var cssRules []string

	scanner := bufio.NewScanner(resp.Body)
	// Increase buffer for very long lines (some filter lists have them)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		rawLine := strings.TrimSpace(scanner.Text())

		// Skip obvious comments
		if (strings.HasPrefix(rawLine, "! ") || strings.HasPrefix(rawLine, "# ")) &&
			!strings.Contains(rawLine, "##") {
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

				// Only generic rules (no domain prefix)
				if prefix == "" && selector != "" {
					isValid := true
					if strings.HasPrefix(selector, "+") || strings.HasPrefix(selector, "^") {
						isValid = false
					} else if strings.Contains(selector, " ") {
						isValid = false
					} else if !containsLetterOrDigit(selector) {
						isValid = false
					} else if strings.Contains(selector, "url(") || strings.Contains(selector, "expression(") {
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

// parseDomainLine extracts a domain from a single line of a filter list.
// Handles hosts-file, AdBlock Plus, and plain domain formats.
func parseDomainLine(line string) string {
	line = strings.TrimSpace(line)

	if line == "" {
		return ""
	}
	if line[0] == '#' || line[0] == '!' {
		return ""
	}
	if strings.HasPrefix(line, "@@") {
		return ""
	}
	if strings.ContainsAny(line, "$/\\*") && !strings.HasPrefix(line, "||") {
		return ""
	}

	var domain string

	switch {
	case strings.HasPrefix(line, "||"):
		domain = strings.TrimPrefix(line, "||")
		if idx := strings.IndexByte(domain, '^'); idx != -1 {
			domain = domain[:idx]
		}
		if idx := strings.IndexByte(domain, '$'); idx != -1 {
			domain = domain[:idx]
		}

	case strings.HasPrefix(line, "0.0.0.0 ") ||
		strings.HasPrefix(line, "0.0.0.0\t") ||
		strings.HasPrefix(line, "127.0.0.1 ") ||
		strings.HasPrefix(line, "127.0.0.1\t"):
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			domain = fields[1]
		}
		if idx := strings.IndexByte(domain, '#'); idx != -1 {
			domain = domain[:idx]
		}

	default:
		if !strings.ContainsAny(line, " \t") && strings.Contains(line, ".") {
			domain = line
		}
	}

	domain = strings.ToLower(strings.TrimSpace(domain))
	if domain == "" || domain == "localhost" || domain == "localhost.localdomain" ||
		domain == "broadcasthost" || domain == "local" {
		return ""
	}
	if !strings.Contains(domain, ".") {
		return ""
	}
	// Reject IP addresses
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

// ────────────────────────────────────────────────────────────────────────────
// Trie Data Structure
// ────────────────────────────────────────────────────────────────────────────

// TrieNode represents a node in the domain Trie tree.
// Domains are stored with reversed labels for efficient subdomain matching.
type TrieNode struct {
	Children   map[string]*TrieNode
	IsTerminal bool
	bfsOffset  int
}

// NewTrieNode creates a new empty TrieNode.
func NewTrieNode() *TrieNode {
	return &TrieNode{Children: make(map[string]*TrieNode)}
}

// Insert adds a domain to the Trie with reversed labels.
// "ads.google.com" → labels ["com", "google", "ads"]
func (t *TrieNode) Insert(domain string) {
	labels := strings.Split(domain, ".")
	node := t
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

// countNodes returns the total number of nodes (including root).
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

// serializeTrieToBytes serializes the Trie to an in-memory byte slice.
// Uses 2-pass BFS: Pass 1 calculates offsets, Pass 2 writes bytes.
//
// Binary format (big-endian):
//
//	HEADER (16 bytes): magic(4) version(4) nodeCount(4) domainCount(4)
//	Each NODE in BFS order:
//	  isTerminal(1) childCount(2)
//	  Per child: labelLen(2) label(N) childOffset(4)
func serializeTrieToBytes(root *TrieNode) ([]byte, error) {
	nodeCount := root.countNodes()
	domainCount := root.countTerminals()

	// ── Pass 1: Calculate byte offsets ──
	queue := []*TrieNode{root}
	offset := 16 // start after header

	for i := 0; i < len(queue); i++ {
		node := queue[i]
		node.bfsOffset = offset

		// isTerminal(1) + childCount(2)
		offset += 3

		for label, child := range node.Children {
			offset += 2 + len(label) + 4
			queue = append(queue, child)
		}
	}

	// ── Pass 2: Write bytes ──
	buf := bytes.NewBuffer(make([]byte, 0, offset))

	// Header (16 bytes, big-endian)
	hdr := make([]byte, 16)
	binary.BigEndian.PutUint32(hdr[0:4], trieMagic)
	binary.BigEndian.PutUint32(hdr[4:8], trieVersion)
	binary.BigEndian.PutUint32(hdr[8:12], uint32(nodeCount))
	binary.BigEndian.PutUint32(hdr[12:16], uint32(domainCount))
	buf.Write(hdr)

	// Nodes in BFS order
	var tmp [4]byte
	for _, node := range queue {
		// isTerminal (1 byte)
		if node.IsTerminal {
			buf.WriteByte(1)
		} else {
			buf.WriteByte(0)
		}

		// childCount (2 bytes)
		binary.BigEndian.PutUint16(tmp[0:2], uint16(len(node.Children)))
		buf.Write(tmp[0:2])

		// Children: labelLen(2) + label(N) + childOffset(4)
		for label, child := range node.Children {
			labelBytes := []byte(label)

			binary.BigEndian.PutUint16(tmp[0:2], uint16(len(labelBytes)))
			buf.Write(tmp[0:2])

			buf.Write(labelBytes)

			binary.BigEndian.PutUint32(tmp[0:4], uint32(child.bfsOffset))
			buf.Write(tmp[0:4])
		}
	}

	return buf.Bytes(), nil
}

// ────────────────────────────────────────────────────────────────────────────
// Bloom Filter
// ────────────────────────────────────────────────────────────────────────────

// BloomFilter is a space-efficient probabilistic data structure using
// FNV-1a + FNV-1 double hashing.
type BloomFilter struct {
	bits      []byte
	bitCount  uint64
	hashCount uint32
}

// NewBloomFilter creates a new Bloom Filter optimized for n elements with FPR 0.1%.
func NewBloomFilter(n int) *BloomFilter {
	if n <= 0 {
		n = 1
	}

	ln2 := math.Ln2
	m := uint64(math.Ceil(-float64(n) * math.Log(bloomFPR) / (ln2 * ln2)))
	m = ((m + 7) / 8) * 8 // round up to nearest multiple of 8

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

// Add inserts a domain into the Bloom Filter.
func (bf *BloomFilter) Add(domain string) {
	h1, h2 := fnvDoubleHash(domain)
	for i := uint32(0); i < bf.hashCount; i++ {
		idx := (h1 + uint64(i)*h2) % bf.bitCount
		bf.bits[idx/8] |= 1 << (idx % 8)
	}
}

// SerializeToBytes serializes the Bloom Filter to an in-memory byte slice.
//
// Binary format (big-endian):
//
//	HEADER (24 bytes): magic(4) version(4) bitCount(8) hashCount(4) padding(4)
//	BIT ARRAY: (bitCount/8) bytes, little-endian bit order
func (bf *BloomFilter) SerializeToBytes() ([]byte, error) {
	buf := bytes.NewBuffer(make([]byte, 0, 24+len(bf.bits)))

	hdr := make([]byte, 24)
	binary.BigEndian.PutUint32(hdr[0:4], bloomMagic)
	binary.BigEndian.PutUint32(hdr[4:8], bloomVersion)
	binary.BigEndian.PutUint64(hdr[8:16], bf.bitCount)
	binary.BigEndian.PutUint32(hdr[16:20], bf.hashCount)
	// hdr[20:24] = padding (zeros)
	buf.Write(hdr)

	buf.Write(bf.bits)

	return buf.Bytes(), nil
}

// fnvDoubleHash computes FNV-1a (h1) and FNV-1 (h2) hashes.
// Identical to the Kotlin BloomFilterBuilder and Go bloom.go in the Android app.
func fnvDoubleHash(s string) (uint64, uint64) {
	data := []byte(s)

	h1 := fnv.New64a()
	h1.Write(data)
	v1 := h1.Sum64()

	h2 := fnv.New64()
	h2.Write(data)
	v2 := h2.Sum64()

	if v2%2 == 0 {
		v2++
	}

	return v1, v2
}

// ────────────────────────────────────────────────────────────────────────────
// CSS Builder
// ────────────────────────────────────────────────────────────────────────────

// buildCSSFile formats extracted selectors into a valid CSS file.
// Each selector becomes: selector { display: none !important; }
func buildCSSFile(selectors []string) []byte {
	var buf bytes.Buffer
	buf.WriteString("/* BlockAds Cosmetic Filter Rules */\n")
	buf.WriteString("/* Auto-generated — DO NOT EDIT */\n\n")

	for _, sel := range selectors {
		fmt.Fprintf(&buf, "%s { display: none !important; }\n", sel)
	}

	return buf.Bytes()
}

// ────────────────────────────────────────────────────────────────────────────
// ZIP Archiver
// ────────────────────────────────────────────────────────────────────────────

// createZipArchive packages .trie, .bloom, .css, and info.json into a
// single in-memory zip archive.
func createZipArchive(name string, trieData, bloomData, cssData, infoData []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	files := []struct {
		name string
		data []byte
	}{
		{name + ".trie", trieData},
		{name + ".bloom", bloomData},
		{name + ".css", cssData},
		{"info.json", infoData},
	}

	for _, f := range files {
		if f.data == nil {
			continue // skip if artifact was not generated (e.g. no domains → no trie)
		}

		w, err := zw.Create(f.name)
		if err != nil {
			return nil, fmt.Errorf("creating zip entry %s: %w", f.name, err)
		}
		if _, err := io.Copy(w, bytes.NewReader(f.data)); err != nil {
			return nil, fmt.Errorf("writing zip entry %s: %w", f.name, err)
		}
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("finalizing zip: %w", err)
	}

	return buf.Bytes(), nil
}

// ────────────────────────────────────────────────────────────────────────────
// URL Validation
// ────────────────────────────────────────────────────────────────────────────

// ValidateURL performs a HEAD request to verify the URL is reachable.
func ValidateURL(rawURL string) error {
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return fmt.Errorf("URL must use http:// or https:// scheme")
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Head(rawURL)
	if err != nil {
		// Fall back to GET if HEAD is not supported
		resp, err = client.Get(rawURL)
		if err != nil {
			return fmt.Errorf("URL is not reachable: %w", err)
		}
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}

	if resp.StatusCode >= 400 {
		return fmt.Errorf("URL returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

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
