package sapphireproxy

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"tailscale.com/tsnet"
)

func TestIsTailnetHost(t *testing.T) {
	for host, want := range map[string]bool{
		"sol":                      true,
		"truenas.tail1234.ts.net":  true,
		"TrueNAS.tail1234.ts.net.": true,
		"100.101.102.103":          true,
		"fd7a:115c:a1e0::1":        true,
		"100.100.100.100":          false,
		"127.0.0.1":                false,
		"localhost":                false,
		"fonts.googleapis.com":     false,
		"192.168.1.10":             false,
	} {
		if got := isTailnetHost(host); got != want {
			t.Errorf("isTailnetHost(%q) = %v, want %v", host, got, want)
		}
	}
}

func TestResolveTailnetIP(t *testing.T) {
	records := map[string][]net.IP{
		"auth.example.dev":  {net.ParseIP("100.110.46.33")},
		"mixed.example.dev": {net.ParseIP("203.0.113.7"), net.ParseIP("fd7a:115c:a1e0::5")},
		"cdn.example.com":   {net.ParseIP("203.0.113.8")},
	}
	defer func(orig func(context.Context, string, string) ([]net.IP, error)) { lookupIP = orig }(lookupIP)
	lookupIP = func(_ context.Context, _, host string) ([]net.IP, error) {
		return records[host], nil
	}

	for host, want := range map[string]string{
		"auth.example.dev":  "100.110.46.33",
		"mixed.example.dev": "fd7a:115c:a1e0::5",
		"cdn.example.com":   "",
		"203.0.113.9":       "",
	} {
		ip, err := resolveTailnetIP(context.Background(), host)
		if err != nil {
			t.Fatal(err)
		}
		if got := ipString(ip); got != want {
			t.Errorf("resolveTailnetIP(%q) = %q, want %q", host, got, want)
		}
	}
}

func ipString(ip net.IP) string {
	if ip == nil {
		return ""
	}
	return ip.String()
}

// Non-tailnet destinations dial directly, so both proxy modes can be
// exercised without bringing up a tailnet node.
func TestProxyDirect(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "hello %s", r.URL.Path)
	}))
	defer upstream.Close()
	upstreamTLS := httptest.NewTLSServer(upstream.Config.Handler)
	defer upstreamTLS.Close()

	p, err := startProxy(&tsnet.Server{})
	if err != nil {
		t.Fatal(err)
	}
	defer p.close()
	proxyURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", p.port))

	for name, tc := range map[string]struct {
		target string
		client *http.Client
	}{
		"absolute-uri": {upstream.URL, upstream.Client()},
		"connect":      {upstreamTLS.URL, upstreamTLS.Client()},
	} {
		t.Run(name, func(t *testing.T) {
			tc.client.Transport.(*http.Transport).Proxy = http.ProxyURL(proxyURL)
			resp, err := tc.client.Get(tc.target + "/path")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if string(body) != "hello /path" {
				t.Fatalf("body = %q", body)
			}
		})
	}
}
