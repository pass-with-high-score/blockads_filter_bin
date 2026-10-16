package compiler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseDomainLine(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"||youtube.com^$domain=sarapbabe.com", ""},
		{"||youtube.com^$badfilter", ""},
		{"||youtube.com^$third-party", ""},
		{"||youtube.com^$3p", ""},
		{"||youtube.com^$script", ""},
		{"||doubleclick.net^", "doubleclick.net"},
		{"||ads.google.com^$important", "ads.google.com"},
		{"0.0.0.0 tracking.example.com", "tracking.example.com"},
		{"127.0.0.1 ad.server.com # comment", "ad.server.com"},
		{"! comment", ""},
		{"##.ad-banner", ""},
		{"vietnamnet.vn##.article-banner", ""},
		{"sarapbabe.com##.-120-600", ""},
		{"example.com#?#.ad", ""},
		{"example.com#@#.ad", ""},
		{"example.com#%#//scriptlet", ""},
		{"-120-600", ""},
		{"ad-widget.", ""},
		{".leadingdot.com", ""},
		{"trailingdot.com.", ""},
		{"double..dot.com", ""},
		{"invalid_char!.com", ""},
		{"@@||whitelist.com^", ""},
		// Wildcard domain format (*.domain.com)
		{"*.telemetry.001-studio.com", "telemetry.001-studio.com"},
		{"*.0-02.net", "0-02.net"},
		// $all modifier (AdGuard / Malware blocklists)
		{"||acc.jiangsujiaxue.com^$all", "acc.jiangsujiaxue.com"},
		{"||urlhaus.abuse.ch^$all,important", "urlhaus.abuse.ch"},
		// dnsmasq format
		{"server=/adikteev.com/", "adikteev.com"},
		{"address=/beacon.krxd.net/0.0.0.0", "beacon.krxd.net"},
		// TLD wildcard rules (from spam-tlds.txt)
		{"||*.actor^", "actor"},
		{"||*.africa^$denyallow=nation.africa", "africa"},
		// Unsupported or contextual rules that must still be rejected
		{"$removeparam=pjclid", ""},
		{"duckduckgo.com,bing.com##a[href*=\"forkful.ai\"]:upward(li):remove()", ""},
	}

	for _, tt := range tests {
		got := parseDomainLine(tt.input)
		if got != tt.expected {
			t.Errorf("parseDomainLine(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}

func TestCombineAndCompileMultipleFilterLists(t *testing.T) {
	// Setup 2 mock filter list servers
	list1Content := `! List 1
||ads.example.com^
0.0.0.0 tracker.com
##.ad-banner
domain1.com##+js(set-constant, foo, false)
`
	list2Content := `! List 2
||analytics.example.com^
0.0.0.0 tracker.com # duplicate
##.ad-banner
##.sponsored-post
domain2.com##+js(abort-on-property-read, bar)
`

	var server1, server2 *httptest.Server
	server1 = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(list1Content))
	}))
	defer server1.Close()

	server2 = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(list2Content))
	}))
	defer server2.Close()

	urls := []string{server1.URL, server2.URL}

	// Test CombineFilterLists: "domains"
	domBytes, count, err := CombineFilterLists(urls, "domains")
	if err != nil {
		t.Fatalf("CombineFilterLists(domains) failed: %v", err)
	}
	if count != 3 { // ads.example.com, tracker.com, analytics.example.com
		t.Errorf("Expected 3 unique domains, got %d", count)
	}
	domStr := string(domBytes)
	if !strings.Contains(domStr, "ads.example.com") || !strings.Contains(domStr, "tracker.com") || !strings.Contains(domStr, "analytics.example.com") {
		t.Errorf("domains output missing expected domains: %s", domStr)
	}

	// Test CombineFilterLists: "adblock"
	abpBytes, abpCount, err := CombineFilterLists(urls, "adblock")
	if err != nil {
		t.Fatalf("CombineFilterLists(adblock) failed: %v", err)
	}
	if abpCount != 7 { // 3 domains + 2 css + 2 scriptlets
		t.Errorf("Expected 7 total rules, got %d", abpCount)
	}
	abpStr := string(abpBytes)
	if !strings.Contains(abpStr, "[Adblock Plus 2.0]") || !strings.Contains(abpStr, "||ads.example.com^") || !strings.Contains(abpStr, "##.sponsored-post") {
		t.Errorf("adblock output missing expected content: %s", abpStr)
	}

	// Test CombineFilterLists: "hosts"
	hostsBytes, hostsCount, err := CombineFilterLists(urls, "hosts")
	if err != nil {
		t.Fatalf("CombineFilterLists(hosts) failed: %v", err)
	}
	if hostsCount != 3 {
		t.Errorf("Expected 3 domains in hosts format, got %d", hostsCount)
	}
	hostsStr := string(hostsBytes)
	if !strings.Contains(hostsStr, "0.0.0.0 ads.example.com") {
		t.Errorf("hosts output missing 0.0.0.0 entry: %s", hostsStr)
	}

	// Test CompileMultipleFilterLists (zip archive generation)
	res, err := CompileMultipleFilterLists("merged_test", urls)
	if err != nil {
		t.Fatalf("CompileMultipleFilterLists failed: %v", err)
	}
	if res.RuleCount != 3 {
		t.Errorf("Expected 3 domain rules, got %d", res.RuleCount)
	}
	if len(res.ZipData) == 0 {
		t.Errorf("Expected non-empty zip data")
	}
}

