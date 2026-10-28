// Package sapphireproxy embeds a userspace Tailscale node (tsnet) and exposes
// it to the host app as a localhost HTTP proxy. Webviews pointed at the proxy
// can load tailnet URLs (MagicDNS names, 100.x IPs) without a system VPN.
//
// The exported API is intentionally gomobile-friendly: only strings, ints,
// bools and errors cross the boundary.
package sapphireproxy

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"tailscale.com/tsnet"
)

var (
	mu     sync.Mutex
	server *tsnet.Server
	proxy  *proxyServer
)

// Start brings up the tailnet node and the local proxy. dir must be a
// writable, persistent directory (node keys live there). It returns once the
// proxy is listening; tailnet login continues in the background, so poll
// Status for the auth URL / running state.
func Start(dir, hostname string) error {
	mu.Lock()
	defer mu.Unlock()
	if server != nil {
		return nil
	}

	// Mobile sandboxes have no $HOME/TMPDIR, so logpolicy can't find a logs
	// directory on its own and panics. Keep logs next to the node state.
	logsDir := filepath.Join(dir, "logs")
	if err := os.MkdirAll(logsDir, 0o700); err != nil {
		return err
	}
	os.Setenv("TS_LOGS_DIR", logsDir)

	s := &tsnet.Server{
		Dir:      dir,
		Hostname: hostname,
		Logf:     logf,
		UserLogf: logf,
	}
	if err := s.Start(); err != nil {
		return err
	}

	p, err := startProxy(s)
	if err != nil {
		s.Close()
		return err
	}

	server, proxy = s, p
	return nil
}

// Stop tears down the proxy and the tailnet node. Node state is kept on disk.
func Stop() {
	mu.Lock()
	defer mu.Unlock()
	if proxy != nil {
		proxy.close()
		proxy = nil
	}
	if server != nil {
		server.Close()
		server = nil
	}
}

// ProxyPort returns the localhost port of the HTTP proxy, or 0 if not started.
func ProxyPort() int {
	mu.Lock()
	defer mu.Unlock()
	if proxy == nil {
		return 0
	}
	return proxy.port
}

type peerStatus struct {
	HostName string   `json:"hostName"`
	DNSName  string   `json:"dnsName"`
	OS       string   `json:"os"`
	IPs      []string `json:"ips"`
	Online   bool     `json:"online"`
}

type status struct {
	BackendState string       `json:"backendState"`
	AuthURL      string       `json:"authURL"`
	Self         *peerStatus  `json:"self"`
	Peers        []peerStatus `json:"peers"`
	ProxyPort    int          `json:"proxyPort"`
}

// Status returns a JSON snapshot of the node: backend state ("NeedsLogin",
// "Running", ...), the pending auth URL if any, and the visible peers.
func Status() (string, error) {
	mu.Lock()
	s, p := server, proxy
	mu.Unlock()
	if s == nil {
		return `{"backendState":"Stopped","peers":[]}`, nil
	}

	lc, err := s.LocalClient()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := lc.Status(ctx)
	if err != nil {
		return "", err
	}

	out := status{
		BackendState: st.BackendState,
		AuthURL:      st.AuthURL,
		Peers:        []peerStatus{},
		ProxyPort:    p.port,
	}
	if st.Self != nil {
		self := toPeer(st.Self.HostName, st.Self.DNSName, st.Self.OS, st.Self.Online, st.TailscaleIPs)
		out.Self = &self
	}
	for _, ps := range st.Peer {
		out.Peers = append(out.Peers, toPeer(ps.HostName, ps.DNSName, ps.OS, ps.Online, ps.TailscaleIPs))
	}

	b, err := json.Marshal(out)
	return string(b), err
}

func toPeer[T interface{ String() string }](host, dns, os string, online bool, ips []T) peerStatus {
	p := peerStatus{
		HostName: host,
		DNSName:  strings.TrimSuffix(dns, "."),
		OS:       os,
		Online:   online,
		IPs:      make([]string, len(ips)),
	}
	for i, ip := range ips {
		p.IPs[i] = ip.String()
	}
	return p
}

// Logout drops the node's credentials so the next Start prompts for login.
func Logout() error {
	mu.Lock()
	s := server
	mu.Unlock()
	if s == nil {
		return errors.New("not started")
	}
	lc, err := s.LocalClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return lc.Logout(ctx)
}

// dial routes tailnet destinations through tsnet and everything else (CDNs,
// fonts, etc. referenced by service UIs) through the regular network.
func dial(s *tsnet.Server) func(ctx context.Context, network, addr string) (net.Conn, error) {
	var direct net.Dialer
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		if isTailnetHost(host) {
			return dialTailnet(ctx, s, network, addr, addr, 0)
		}
		started := time.Now()
		ip, err := resolveTailnetIP(ctx, host)
		if err != nil {
			return nil, err
		}
		if ip != nil {
			return dialTailnet(ctx, s, network, addr, net.JoinHostPort(ip.String(), port), time.Since(started))
		}
		return direct.DialContext(ctx, network, addr)
	}
}

// dialTailnet dials target through tsnet and logs how long it took (and how long the public DNS
// lookup that found it took), since the first dials after a cold start wait on the tailnet.
func dialTailnet(ctx context.Context, s *tsnet.Server, network, addr, target string, lookup time.Duration) (net.Conn, error) {
	started := time.Now()
	conn, err := s.Dial(ctx, network, target)
	if err == nil {
		logf("proxy: dialed %s over the tailnet in %dms (dns %dms)", addr, time.Since(started).Milliseconds(), lookup.Milliseconds())
	}
	return conn, err
}

var lookupIP = net.DefaultResolver.LookupIP

// resolveTailnetIP resolves host through regular DNS and returns its first
// tailnet address, or nil if it has none. Public records can point at tailnet
// IPs (e.g. a Cloudflare record for a tailnet-only service), and those are
// unreachable over the regular network.
func resolveTailnetIP(ctx context.Context, host string) (net.IP, error) {
	if net.ParseIP(host) != nil {
		return nil, nil
	}
	ips, err := lookupIP(ctx, "ip", host)
	if err != nil {
		return nil, err
	}
	for _, ip := range ips {
		if isTailnetIP(ip) {
			return ip, nil
		}
	}
	return nil, nil
}

var (
	cgnat   = mustCIDR("100.64.0.0/10")
	tsULA   = mustCIDR("fd7a:115c:a1e0::/48")
	magicIP = net.ParseIP("100.100.100.100")
)

func isTailnetIP(ip net.IP) bool {
	return !ip.Equal(magicIP) && (cgnat.Contains(ip) || tsULA.Contains(ip))
}

func isTailnetHost(host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		return isTailnetIP(ip)
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "localhost" {
		return false
	}
	// Bare names ("sol", "truenas") are MagicDNS short names.
	return strings.HasSuffix(host, ".ts.net") || !strings.Contains(host, ".")
}

func mustCIDR(s string) *net.IPNet {
	_, n, err := net.ParseCIDR(s)
	if err != nil {
		panic(err)
	}
	return n
}
