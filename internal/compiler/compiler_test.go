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
	}

	for _, tt := range tests {
		got := parseDomainLine(tt.input)
		if got != tt.expected {
			t.Errorf("parseDomainLine(%q) = %q; want %q", tt.input, got, tt.expected)
		}
	}
}
