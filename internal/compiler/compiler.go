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
	"sort"
	"strings"
	"time"

	"blockads-filtering/internal/model"
)

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const (
	trieMagic    = 0x54524945 // "TRIE"
	trieVersion  = 2
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

		// childCount (4 bytes)
		childCount := len(node.Children)
		binary.BigEndian.PutUint32(tmp[0:4], uint32(childCount))
		buf.Write(tmp[0:4])

		// Sort labels
		var labels []string
		for label := range node.Children {
			labels = append(labels, label)
		}
		sort.Strings(labels)

		for _, label := range labels {
			child := node.Children[label]
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

// OptimalBloomParams tính toán bitCount và hashCount tối ưu
// fpRate: tỉ lệ False Positive mong muốn (vd: 0.001 = 0.1%)
func OptimalBloomParams(expectedItems int, fpRate float64) (bitCount uint64, hashCount uint32) {
	if expectedItems <= 0 {
		expectedItems = 1
	}
	if fpRate <= 0 || fpRate >= 1 {
		fpRate = 0.001
	}
	n := float64(expectedItems)
	m := -n * math.Log(fpRate) / (math.Ln2 * math.Ln2)
	k := (m / n) * math.Ln2

	bitCount = uint64(math.Ceil(m))
	hashCount = uint32(math.Max(math.Ceil(k), 1))

	// Làm tròn bitCount lên thành byte
	if bitCount%8 != 0 {
		bitCount = (bitCount/8 + 1) * 8
	}
	return
}

// NewBloomFilter creates a new Bloom Filter optimized for n elements with FPR 0.1%.
func NewBloomFilter(expectedItems int) *BloomFilter {
	bitCount, hashCount := OptimalBloomParams(expectedItems, bloomFPR)
	byteCount := bitCount / 8
	return &BloomFilter{
		bits:      make([]byte, byteCount),
		bitCount:  bitCount,
		hashCount: hashCount,
	}
}

// bloomDoubleHash sinh ra 2 hash độc lập: FNV-1a và FNV-1
func bloomDoubleHash(s string) (uint64, uint64) {
	h1 := fnv.New64a()
	h1.Write([]byte(s))
	v1 := h1.Sum64()

	h2 := fnv.New64()
	h2.Write([]byte(s))
	v2 := h2.Sum64()

	if v2%2 == 0 {
		v2++
	}

	return v1, v2
}

func (b *BloomFilter) hash(domain string, i uint32) uint64 {
	h1, h2 := bloomDoubleHash(domain)
	return h1 + uint64(i)*h2
}

// Add inserts a domain into the Bloom Filter.
func (b *BloomFilter) Add(domain string) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	domain = strings.TrimPrefix(domain, "*.")
	if domain == "" {
		return
	}
	for i := uint32(0); i < b.hashCount; i++ {
		idx := b.hash(domain, i) % b.bitCount
		b.bits[idx/8] |= 1 << (idx % 8)
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

// ValidateFilterListURL performs a 3-stage validation to ensure a URL actually
// points to a valid ad-blocking filter list, not an HTML page or random file.
//
// Stage 1: Format check (http/https scheme).
// Stage 2: Content-Type check via HEAD request (reject HTML, JSON, media types).
// Stage 3: Content sniffing — downloads the first 5 KB and scans for ad-block syntax.
func ValidateFilterListURL(rawURL string) error {
	// ── Stage 1: Format Check ──
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return fmt.Errorf("URL must use http:// or https:// scheme")
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// ── Stage 2: Content-Type Check (HEAD request) ──
	resp, err := client.Head(rawURL)
	if err == nil {
		resp.Body.Close()

		if resp.StatusCode >= 400 {
			return fmt.Errorf("URL returned HTTP %d", resp.StatusCode)
		}

		ct := strings.ToLower(resp.Header.Get("Content-Type"))
		if ct != "" {
			// Extract the media type (ignore charset and other params)
			if idx := strings.Index(ct, ";"); idx != -1 {
				ct = strings.TrimSpace(ct[:idx])
			}

			// Reject types that are clearly not filter lists
			rejectedTypes := []string{
				"text/html",
				"application/json",
				"application/xml",
				"text/xml",
			}
			rejectedPrefixes := []string{
				"image/",
				"video/",
				"audio/",
				"application/zip",
				"application/pdf",
			}

			for _, rt := range rejectedTypes {
				if ct == rt {
					return fmt.Errorf("Content-Type is %s; expected a plain text filter list", ct)
				}
			}
			for _, rp := range rejectedPrefixes {
				if strings.HasPrefix(ct, rp) {
					return fmt.Errorf("Content-Type is %s; expected a plain text filter list", ct)
				}
			}
		}
	}
	// If HEAD fails (some servers don't support it), continue to Stage 3

	// ── Stage 3: Content Sniffing (partial GET, first 5 KB) ──
	req, err := http.NewRequest("GET", rawURL, nil)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	// Try with Range header first; request only the first 16 KB
	req.Header.Set("Range", "bytes=0-16383")
	resp, err = client.Do(req)
	if err != nil {
		return fmt.Errorf("URL is not reachable: %w", err)
	}

	// If server rejects Range request, fallback to a normal GET
	if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable || resp.StatusCode == http.StatusNotImplemented {
		resp.Body.Close()
		req.Header.Del("Range")
		resp, err = client.Do(req)
		if err != nil {
			return fmt.Errorf("URL is not reachable on fallback: %w", err)
		}
	}
	defer resp.Body.Close() // Keep defer after fallback is handled

	if resp.StatusCode >= 400 {
		return fmt.Errorf("URL returned HTTP %d", resp.StatusCode)
	}

	// Read at most 16 KB
	const maxBytes = 16384
	buf := make([]byte, maxBytes)
	n, _ := io.ReadFull(resp.Body, buf)
	if n == 0 {
		return fmt.Errorf("URL returned empty response body")
	}
	chunk := string(buf[:n])

	// Quick HTML detection — reject if the body starts with HTML
	trimmed := strings.TrimSpace(chunk)
	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "<!doctype") || strings.HasPrefix(lower, "<html") || strings.HasPrefix(lower, "<head") {
		return fmt.Errorf("URL contains HTML, not a filter list")
	}

	// Scan lines for ad-blocking heuristics
	matched := false
	plainDomainCount := 0          // count lines that look like plain domains
	const plainDomainThreshold = 3 // need at least 3 plain domain lines to confirm
	scanner := bufio.NewScanner(strings.NewReader(chunk))
	lineCount := 0
	const maxLines = 300

	for scanner.Scan() && lineCount < maxLines {
		line := strings.TrimSpace(scanner.Text())
		lineCount++

		if line == "" {
			continue
		}

		// Heuristic checks — any single match is sufficient
		switch {
		// AdBlock Plus header
		case strings.HasPrefix(line, "[Adblock Plus"):
			matched = true
		case strings.HasPrefix(line, "[Adblock"):
			matched = true

		// ABP metadata (! prefix)
		case strings.HasPrefix(line, "! Title:"):
			matched = true
		case strings.HasPrefix(line, "! Homepage:"):
			matched = true
		case strings.HasPrefix(line, "! Last modified:"):
			matched = true

		// Hosts/domain-list metadata (# prefix, Hagezi style)
		case strings.HasPrefix(line, "# Title:"):
			matched = true
		case strings.HasPrefix(line, "# Description:"):
			matched = true
		case strings.HasPrefix(line, "# Homepage:"):
			matched = true
		case strings.HasPrefix(line, "# Expires:"):
			matched = true
		case strings.HasPrefix(line, "# Syntax:"):
			matched = true
		case strings.HasPrefix(line, "# Version:"):
			matched = true
		case strings.HasPrefix(line, "# License:"):
			matched = true
		case strings.HasPrefix(line, "# Number of entries:") || strings.HasPrefix(line, "#Number of Entries:"):
			matched = true
		case strings.HasPrefix(line, "# Last Updated:") || strings.HasPrefix(line, "#Last Updated:"):
			matched = true
		case strings.HasPrefix(line, "Created using"):
			matched = true

		// Hosts file format
		case strings.HasPrefix(line, "0.0.0.0 ") || strings.HasPrefix(line, "0.0.0.0\t"):
			matched = true
		case strings.HasPrefix(line, "127.0.0.1 ") || strings.HasPrefix(line, "127.0.0.1\t"):
			matched = true

		// Network rules (AdBlock Plus syntax)
		case strings.HasPrefix(line, "||"):
			matched = true
		case strings.HasPrefix(line, "@@||"):
			matched = true

		// CSS cosmetic filter rules (e.g. "example.com##.ad-banner" or "##.ad-class")
		case strings.Contains(line, "##") && !strings.HasPrefix(line, "#"):
			matched = true

		default:
			// Plain domain detection (Hagezi domain-list format):
			// Non-comment lines that contain a dot and no spaces → likely a domain
			if !strings.HasPrefix(line, "#") && !strings.HasPrefix(line, "!") &&
				strings.Contains(line, ".") && !strings.ContainsAny(line, " \t") {
				plainDomainCount++
				if plainDomainCount >= plainDomainThreshold {
					matched = true
				}
			}
		}

		if matched {
			break
		}
	}

	if !matched {
		return fmt.Errorf("URL does not contain recognizable ad-blocking filter list syntax")
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
