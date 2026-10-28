package sapphireproxy

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"time"

	"tailscale.com/tsnet"
)

// proxyServer is a minimal forward HTTP proxy: CONNECT for tunnelled traffic
// (https, and everything on iOS, which tunnels all proxied connections) and
// absolute-URI requests for plain http (Android WebView).
type proxyServer struct {
	port int
	srv  *http.Server
}

func startProxy(s *tsnet.Server) (*proxyServer, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}

	dialer := dial(s)
	transport := &http.Transport{
		DialContext:         dialer,
		Proxy:               nil,
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        64,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	forward := &httputil.ReverseProxy{
		// Proxy requests already carry an absolute URL and the right Host.
		Director:      func(*http.Request) {},
		Transport:     transport,
		FlushInterval: -1,
		ErrorLog:      nil,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			logf("proxy: %s %s: %v", r.Method, r.URL, err)
			http.Error(w, err.Error(), http.StatusBadGateway)
		},
	}

	p := &proxyServer{port: ln.Addr().(*net.TCPAddr).Port}
	p.srv = &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodConnect {
				tunnel(w, r, dialer)
				return
			}
			if !r.URL.IsAbs() {
				http.Error(w, "sapphire-proxy: expected a proxy request", http.StatusBadRequest)
				return
			}
			forward.ServeHTTP(w, r)
		}),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go p.srv.Serve(ln)

	logf("proxy: listening on %s", ln.Addr())
	return p, nil
}

func (p *proxyServer) close() {
	p.srv.Close()
}

func tunnel(w http.ResponseWriter, r *http.Request, dialer func(ctx context.Context, network, addr string) (net.Conn, error)) {
	started := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	upstream, err := dialer(ctx, "tcp", r.Host)
	cancel()
	if err != nil {
		logf("proxy: CONNECT %s failed after %dms: %v", r.Host, time.Since(started).Milliseconds(), err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		upstream.Close()
		http.Error(w, "hijacking not supported", http.StatusInternalServerError)
		return
	}
	client, buf, err := hj.Hijack()
	if err != nil {
		upstream.Close()
		return
	}
	client.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	go func() {
		// Flush anything the client sent after the CONNECT headers.
		if n := buf.Reader.Buffered(); n > 0 {
			b, _ := buf.Reader.Peek(n)
			upstream.Write(b)
		}
		io.Copy(upstream, client)
		upstream.Close()
	}()
	io.Copy(client, upstream)
	client.Close()
}
