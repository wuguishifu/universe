package sapphireproxy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// SSH over the same tsnet node the proxy uses, so tailnet machines are reachable by MagicDNS name
// without a VPN. Credentials come in from native code (Keychain, vault) and never touch disk here;
// only host keys are kept, trust on first use, in known_hosts next to the node state.

const (
	sshConnectTimeout   = 20 * time.Second
	sshKeepaliveEvery   = 30 * time.Second
	sshKeepaliveTimeout = 15 * time.Second
	sshReadBuffer       = 32 * 1024
)

// Error codes, as the prefix of the error message ("ERR_SSH_AUTH_FAILED: ..."), since only the
// message survives gomobile. The host splits them off for JS.
const (
	sshErrNotStarted     = "ERR_SSH_TAILNET_NOT_RUNNING"
	sshErrUnreachable    = "ERR_SSH_UNREACHABLE"
	sshErrAuthFailed     = "ERR_SSH_AUTH_FAILED"
	sshErrHostKeyChanged = "ERR_SSH_HOST_KEY_CHANGED"
	sshErrInvalidKey     = "ERR_SSH_INVALID_KEY"
	sshErrKeyEncrypted   = "ERR_SSH_KEY_ENCRYPTED"
	sshErrHandshake      = "ERR_SSH_HANDSHAKE"
	sshErrClosed         = "ERR_SSH_CLOSED"
)

type sshError struct {
	code string
	msg  string
}

func (e *sshError) Error() string { return e.code + ": " + e.msg }

func sshErrorf(code, format string, args ...any) error {
	return &sshError{code: code, msg: fmt.Sprintf(format, args...)}
}

// SSHListener receives a shell's output. gomobile turns it into a protocol the host implements.
type SSHListener interface {
	// OnData is called from a background goroutine with each chunk of output, in order.
	OnData(data []byte)
	// OnClose is called once, after the last OnData. message is empty for a clean exit.
	OnClose(message string)
}

// SSHClient is an authenticated connection that can run one interactive shell.
type SSHClient struct {
	client     *ssh.Client
	addr       string
	hostKey    ssh.PublicKey
	newHostKey bool
	done       chan struct{}

	mu       sync.Mutex
	session  *ssh.Session
	stdin    io.WriteCloser
	closed   bool
	lostConn bool
}

// SSHConnect dials host:port over the tailnet and authenticates as user with a password or an
// OpenSSH/PEM private key (pass "" for the one not used). An unknown host key is trusted and
// remembered once authentication succeeds; a key that differs from the remembered one fails with
// ERR_SSH_HOST_KEY_CHANGED until SSHForgetHostKey.
func SSHConnect(host string, port int, user, password, privateKey string) (*SSHClient, error) {
	mu.Lock()
	s, dir := server, stateDir
	mu.Unlock()
	if s == nil {
		return nil, sshErrorf(sshErrNotStarted, "the tailnet isn't running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), sshConnectTimeout)
	defer cancel()
	return connectSSH(ctx, s.Dial, knownHostsAt(dir), host, port, user, password, privateKey)
}

// SSHForgetHostKey drops the remembered host key for host:port, so the next connection trusts
// whatever key the server presents.
func SSHForgetHostKey(host string, port int) error {
	mu.Lock()
	dir := stateDir
	mu.Unlock()
	if dir == "" {
		return sshErrorf(sshErrNotStarted, "the tailnet isn't running")
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	return knownHostsAt(dir).forget(net.JoinHostPort(host, strconv.Itoa(port)))
}

type dialFunc func(ctx context.Context, network, addr string) (net.Conn, error)

func connectSSH(ctx context.Context, dial dialFunc, hosts *knownHosts, host string, port int,
	user, password, privateKey string) (*SSHClient, error) {
	// MagicDNS names are case-insensitive; keep one known_hosts entry per machine.
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	auth, err := sshAuthMethods(password, privateKey)
	if err != nil {
		return nil, err
	}

	known, err := hosts.lookup(addr)
	if err != nil {
		return nil, err
	}
	var hostKey ssh.PublicKey
	config := &ssh.ClientConfig{
		User: user,
		Auth: auth,
		HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
			if known != nil && !bytes.Equal(known.Marshal(), key.Marshal()) {
				return sshErrorf(sshErrHostKeyChanged,
					"%s presented a different host key (%s %s) than the one remembered (%s %s)",
					addr, key.Type(), ssh.FingerprintSHA256(key), known.Type(), ssh.FingerprintSHA256(known))
			}
			hostKey = key
			return nil
		},
	}
	if known != nil {
		// Ask for the remembered key's type, so a server with several host keys doesn't look
		// like it changed just because negotiation picked another one.
		config.HostKeyAlgorithms = hostKeyAlgorithms(known.Type())
	}

	started := time.Now()
	conn, err := dial(ctx, "tcp", addr)
	if err != nil {
		return nil, sshErrorf(sshErrUnreachable, "couldn't reach %s: %v", addr, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		conn.SetDeadline(deadline)
	}
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		conn.Close()
		return nil, classifySSHError(err)
	}
	conn.SetDeadline(time.Time{})

	isNew := known == nil
	if isNew {
		if err := hosts.add(addr, hostKey); err != nil {
			logf("ssh: couldn't remember %s's host key: %v", addr, err)
		}
	}
	trust := "known"
	if isNew {
		trust = "new"
	}
	logf("ssh: connected to %s as %s in %dms (%s host key %s)", addr, user,
		time.Since(started).Milliseconds(), trust, ssh.FingerprintSHA256(hostKey))

	client := &SSHClient{
		client:     ssh.NewClient(c, chans, reqs),
		addr:       addr,
		hostKey:    hostKey,
		newHostKey: isNew,
		done:       make(chan struct{}),
	}
	go client.keepalive()
	return client, nil
}

func sshAuthMethods(password, privateKey string) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod
	if privateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(privateKey))
		var missing *ssh.PassphraseMissingError
		switch {
		case errors.As(err, &missing):
			return nil, sshErrorf(sshErrKeyEncrypted, "the private key is protected by a passphrase")
		case err != nil:
			return nil, sshErrorf(sshErrInvalidKey, "couldn't read the private key: %v", err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}
	if password != "" {
		methods = append(methods,
			ssh.Password(password),
			// Servers with PasswordAuthentication off often still take the password this way.
			ssh.KeyboardInteractive(func(_, _ string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					if !echos[i] {
						answers[i] = password
					}
				}
				return answers, nil
			}))
	}
	if len(methods) == 0 {
		return nil, sshErrorf(sshErrAuthFailed, "no password or key to authenticate with")
	}
	return methods, nil
}

func classifySSHError(err error) error {
	var coded *sshError
	if errors.As(err, &coded) {
		return coded
	}
	if strings.Contains(err.Error(), "unable to authenticate") {
		return sshErrorf(sshErrAuthFailed, "the server rejected the credentials")
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return sshErrorf(sshErrUnreachable, "timed out during the SSH handshake")
	}
	return sshErrorf(sshErrHandshake, "%v", err)
}

func hostKeyAlgorithms(keyType string) []string {
	if keyType == ssh.KeyAlgoRSA {
		return []string{ssh.KeyAlgoRSASHA512, ssh.KeyAlgoRSASHA256, ssh.KeyAlgoRSA}
	}
	return []string{keyType}
}

// HostKeyFingerprint is the server's host key as SHA256:<base64>, like ssh-keygen -l.
func (c *SSHClient) HostKeyFingerprint() string { return ssh.FingerprintSHA256(c.hostKey) }

// HostKeyType is the host key's algorithm, e.g. ssh-ed25519.
func (c *SSHClient) HostKeyType() string { return c.hostKey.Type() }

// HostKeyIsNew reports whether this connection trusted the host key for the first time.
func (c *SSHClient) HostKeyIsNew() bool { return c.newHostKey }

// StartShell requests an xterm-256color PTY of cols x rows and starts the login shell. Output
// goes to listener until the shell exits or the connection drops, then OnClose fires once.
func (c *SSHClient) StartShell(cols, rows int, listener SSHListener) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return sshErrorf(sshErrClosed, "the connection is closed")
	}
	if c.session != nil {
		return sshErrorf(sshErrClosed, "the shell is already running")
	}

	session, err := c.client.NewSession()
	if err != nil {
		return sshErrorf(sshErrClosed, "couldn't open a session: %v", err)
	}
	// Most servers only accept LANG with AcceptEnv; without it, a UTF-8 locale is up to them.
	_ = session.Setenv("LANG", "en_US.UTF-8")
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 38400, ssh.TTY_OP_OSPEED: 38400}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		session.Close()
		return sshErrorf(sshErrClosed, "the server refused a terminal: %v", err)
	}
	stdin, err := session.StdinPipe()
	if err != nil {
		session.Close()
		return err
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		return err
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		session.Close()
		return err
	}
	if err := session.Shell(); err != nil {
		session.Close()
		return sshErrorf(sshErrClosed, "the server refused a shell: %v", err)
	}
	c.session, c.stdin = session, stdin

	var pumps sync.WaitGroup
	pump := func(r io.Reader) {
		defer pumps.Done()
		buf := make([]byte, sshReadBuffer)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				listener.OnData(append([]byte(nil), buf[:n]...))
			}
			if err != nil {
				return
			}
		}
	}
	pumps.Add(2)
	go pump(stdout)
	go pump(stderr)

	go func() {
		err := session.Wait()
		pumps.Wait()
		c.mu.Lock()
		closedByUs, lost := c.closed, c.lostConn
		c.mu.Unlock()
		c.Close()

		message := ""
		var exit *ssh.ExitError
		switch {
		case lost:
			message = "Connection lost"
		case closedByUs:
		case errors.As(err, &exit):
			message = fmt.Sprintf("Exited with status %d", exit.ExitStatus())
		case err != nil:
			message = "Connection lost"
		}
		logf("ssh: %s closed (%q)", c.addr, message)
		listener.OnClose(message)
	}()
	return nil
}

// Write sends keystrokes (or pasted text) to the shell.
func (c *SSHClient) Write(data []byte) error {
	c.mu.Lock()
	stdin := c.stdin
	c.mu.Unlock()
	if stdin == nil {
		return sshErrorf(sshErrClosed, "the shell isn't running")
	}
	_, err := stdin.Write(data)
	return err
}

// Resize tells the server the terminal is now cols x rows.
func (c *SSHClient) Resize(cols, rows int) error {
	c.mu.Lock()
	session := c.session
	c.mu.Unlock()
	if session == nil {
		return sshErrorf(sshErrClosed, "the shell isn't running")
	}
	return session.WindowChange(rows, cols)
}

// Close ends the shell and the connection. Safe to call more than once.
func (c *SSHClient) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	session := c.session
	c.mu.Unlock()

	close(c.done)
	if session != nil {
		session.Close()
	}
	c.client.Close()
}

// keepalive notices a dead connection (e.g. the phone changed networks) instead of leaving the
// shell hanging until TCP gives up.
func (c *SSHClient) keepalive() {
	ticker := time.NewTicker(sshKeepaliveEvery)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
		}
		replied := make(chan error, 1)
		go func() {
			_, _, err := c.client.SendRequest("keepalive@openssh.com", true, nil)
			replied <- err
		}()
		var err error
		select {
		case <-c.done:
			return
		case err = <-replied:
		case <-time.After(sshKeepaliveTimeout):
			err = errors.New("no reply")
		}
		if err != nil {
			logf("ssh: %s keepalive failed: %v", c.addr, err)
			c.mu.Lock()
			c.lostConn = true
			c.mu.Unlock()
			c.Close()
			return
		}
	}
}

// knownHosts is a known_hosts file with one key per host, in OpenSSH's format.
type knownHosts struct {
	path string
}

var knownHostsMu sync.Mutex

func knownHostsAt(dir string) *knownHosts {
	return &knownHosts{path: filepath.Join(dir, "ssh", "known_hosts")}
}

func (k *knownHosts) lookup(addr string) (ssh.PublicKey, error) {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	entries, err := k.read()
	if err != nil {
		return nil, err
	}
	return entries[knownhosts.Normalize(addr)], nil
}

func (k *knownHosts) add(addr string, key ssh.PublicKey) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	entries, err := k.read()
	if err != nil {
		return err
	}
	entries[knownhosts.Normalize(addr)] = key
	return k.write(entries)
}

func (k *knownHosts) forget(addr string) error {
	knownHostsMu.Lock()
	defer knownHostsMu.Unlock()
	entries, err := k.read()
	if err != nil {
		return err
	}
	delete(entries, knownhosts.Normalize(addr))
	return k.write(entries)
}

func (k *knownHosts) read() (map[string]ssh.PublicKey, error) {
	entries := map[string]ssh.PublicKey{}
	data, err := os.ReadFile(k.path)
	if errors.Is(err, os.ErrNotExist) {
		return entries, nil
	}
	if err != nil {
		return nil, err
	}
	for line := range strings.SplitSeq(string(data), "\n") {
		host, rest, ok := strings.Cut(strings.TrimSpace(line), " ")
		if !ok || strings.HasPrefix(host, "#") {
			continue
		}
		key, _, _, _, err := ssh.ParseAuthorizedKey([]byte(rest))
		if err != nil {
			continue
		}
		entries[host] = key
	}
	return entries, nil
}

func (k *knownHosts) write(entries map[string]ssh.PublicKey) error {
	if err := os.MkdirAll(filepath.Dir(k.path), 0o700); err != nil {
		return err
	}
	var b strings.Builder
	for host, key := range entries {
		b.WriteString(knownhosts.Line([]string{host}, key))
		b.WriteByte('\n')
	}
	tmp := k.path + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, k.path)
}
