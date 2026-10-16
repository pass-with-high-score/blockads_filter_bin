package compiler

import "testing"

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
