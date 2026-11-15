package sapphireproxy

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// testSSHServer accepts one user with a password (via password or keyboard-interactive auth) or
// a public key, and runs a "shell" that echoes input, reports window changes, and exits on "q".
type testSSHServer struct {
	t        *testing.T
	addr     string
	hostKey  ssh.Signer
	password string
	userKey  ssh.PublicKey
	kbdOnly  bool
	// stallPty leaves pty-req unanswered; refusePty rejects it.
	stallPty  bool
	refusePty bool
	ptyReqs   chan struct{}

	mu      sync.Mutex
	ptyTerm string
	ptySize [2]uint32
}

func newTestSSHServer(t *testing.T, hostKey ssh.Signer) *testSSHServer {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	srv := &testSSHServer{t: t, addr: ln.Addr().String(), hostKey: hostKey, password: "hunter2",
		ptyReqs: make(chan struct{}, 8)}

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go srv.serve(conn)
		}
	}()
	return srv
}

// configure changes the server's settings for the connections that follow.
func (srv *testSSHServer) configure(change func(*testSSHServer)) {
	srv.mu.Lock()
	defer srv.mu.Unlock()
	change(srv)
}

func (srv *testSSHServer) serve(conn net.Conn) {
	srv.mu.Lock()
	hostKey, password, userKey, kbdOnly := srv.hostKey, srv.password, srv.userKey, srv.kbdOnly
	srv.mu.Unlock()

	config := &ssh.ServerConfig{
		KeyboardInteractiveCallback: func(_ ssh.ConnMetadata, challenge ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
			answers, err := challenge("", "", []string{"Password: "}, []bool{false})
			if err != nil || len(answers) != 1 || answers[0] != password {
				return nil, errors.New("wrong password")
			}
			return nil, nil
		},
		PublicKeyCallback: func(_ ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if userKey != nil && bytes.Equal(key.Marshal(), userKey.Marshal()) {
				return nil, nil
			}
			return nil, errors.New("unknown key")
		},
	}
	if !kbdOnly {
		config.PasswordCallback = func(_ ssh.ConnMetadata, given []byte) (*ssh.Permissions, error) {
			if string(given) == password {
				return nil, nil
			}
			return nil, errors.New("wrong password")
		}
	}
	config.AddHostKey(hostKey)

	_, chans, reqs, err := ssh.NewServerConn(conn, config)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for ch := range chans {
		if ch.ChannelType() != "session" {
			ch.Reject(ssh.UnknownChannelType, "")
			continue
		}
		channel, requests, err := ch.Accept()
		if err != nil {
			return
		}
		go srv.session(channel, requests)
	}
}

func (srv *testSSHServer) session(channel ssh.Channel, requests <-chan *ssh.Request) {
	for req := range requests {
		switch req.Type {
		case "pty-req":
			term, rest := readSSHString(req.Payload)
			srv.mu.Lock()
			srv.ptyTerm = term
			srv.ptySize = [2]uint32{binary.BigEndian.Uint32(rest), binary.BigEndian.Uint32(rest[4:])}
			stall, refuse := srv.stallPty, srv.refusePty
			srv.mu.Unlock()
			srv.ptyReqs <- struct{}{}
			if !stall {
				req.Reply(!refuse, nil)
			}
		case "window-change":
			cols, rows := binary.BigEndian.Uint32(req.Payload), binary.BigEndian.Uint32(req.Payload[4:])
			channel.Write([]byte(fmt.Sprintf("resized %dx%d\n", cols, rows)))
		case "shell":
			req.Reply(true, nil)
			go func() {
				channel.Write([]byte("welcome\n"))
				buf := make([]byte, 256)
				for {
					n, err := channel.Read(buf)
					if err != nil {
						return
					}
					if bytes.Contains(buf[:n], []byte("q")) {
						channel.SendRequest("exit-status", false, binary.BigEndian.AppendUint32(nil, 3))
						channel.Close()
						return
					}
					channel.Write(buf[:n])
				}
			}()
		default:
			req.Reply(false, nil)
		}
	}
}

func readSSHString(b []byte) (string, []byte) {
	n := binary.BigEndian.Uint32(b)
	return string(b[4 : 4+n]), b[4+n:]
}

func newSigner(t *testing.T) (ssh.Signer, ed25519.PrivateKey) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	return signer, priv
}

type recordingListener struct {
	mu     sync.Mutex
	out    bytes.Buffer
	closed chan string
}

func newRecordingListener() *recordingListener {
	return &recordingListener{closed: make(chan string, 1)}
}

func (l *recordingListener) OnData(data []byte) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.out.Write(data)
}

func (l *recordingListener) OnClose(message string) { l.closed <- message }

func (l *recordingListener) waitFor(t *testing.T, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		l.mu.Lock()
		got := l.out.String()
		l.mu.Unlock()
		if strings.Contains(got, want) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	t.Fatalf("output %q never contained %q", l.out.String(), want)
}

func testConnect(t *testing.T, hosts *knownHosts, srv *testSSHServer, password, privateKey string) (*SSHClient, error) {
	t.Helper()
	host, port, _ := net.SplitHostPort(srv.addr)
	var d net.Dialer
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return connectSSH(ctx, d.DialContext, hosts, host, atoiPort(port), "bo", password, privateKey)
}

func atoiPort(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func sshErrorCode(err error) string {
	var coded *sshError
	if errors.As(err, &coded) {
		return coded.code
	}
	return ""
}

func TestSSHPasswordShell(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	hosts := knownHostsAt(t.TempDir())

	client, err := testConnect(t, hosts, srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if !client.HostKeyIsNew() || client.HostKeyFingerprint() != ssh.FingerprintSHA256(hostKey.PublicKey()) {
		t.Errorf("host key: new=%v %s", client.HostKeyIsNew(), client.HostKeyFingerprint())
	}

	listener := newRecordingListener()
	if err := client.StartShell(100, 30, listener); err != nil {
		t.Fatal(err)
	}
	listener.waitFor(t, "welcome")
	srv.mu.Lock()
	if srv.ptyTerm != "xterm-256color" || srv.ptySize != [2]uint32{100, 30} {
		t.Errorf("pty = %s %v", srv.ptyTerm, srv.ptySize)
	}
	srv.mu.Unlock()

	if err := client.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	listener.waitFor(t, "hello")
	if err := client.Resize(120, 40); err != nil {
		t.Fatal(err)
	}
	listener.waitFor(t, "resized 120x40")

	client.Write([]byte("q"))
	select {
	case message := <-listener.closed:
		if message != "Exited with status 3" {
			t.Errorf("close message = %q", message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("OnClose never fired")
	}
	if err := client.Write([]byte("x")); err == nil {
		t.Error("write after exit succeeded")
	}
}

func TestSSHCloseByClientIsClean(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	client, err := testConnect(t, knownHostsAt(t.TempDir()), srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	listener := newRecordingListener()
	if err := client.StartShell(80, 24, listener); err != nil {
		t.Fatal(err)
	}
	listener.waitFor(t, "welcome")
	client.Close()
	client.Close()
	select {
	case message := <-listener.closed:
		if message != "" {
			t.Errorf("close message = %q, want clean", message)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("OnClose never fired")
	}
}

func TestSSHCloseInterruptsStalledStart(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	srv.configure(func(srv *testSSHServer) { srv.stallPty = true })
	client, err := testConnect(t, knownHostsAt(t.TempDir()), srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan error, 1)
	go func() { started <- client.StartShell(80, 24, newRecordingListener()) }()
	select {
	case <-srv.ptyReqs:
	case <-time.After(5 * time.Second):
		t.Fatal("the server never got pty-req")
	}

	closed := make(chan struct{})
	go func() {
		client.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("Close blocked behind the stalled StartShell")
	}
	select {
	case err := <-started:
		if sshErrorCode(err) != sshErrClosed {
			t.Errorf("StartShell = %v, want %s", err, sshErrClosed)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("StartShell didn't return after Close")
	}
}

func TestSSHFailedStartClosesConnection(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	srv.configure(func(srv *testSSHServer) { srv.refusePty = true })
	client, err := testConnect(t, knownHostsAt(t.TempDir()), srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.StartShell(80, 24, newRecordingListener()); sshErrorCode(err) != sshErrClosed {
		t.Fatalf("StartShell = %v, want %s", err, sshErrClosed)
	}
	select {
	case <-client.done:
	case <-time.After(2 * time.Second):
		t.Fatal("the connection stayed open after the shell failed to start")
	}
	if err := client.StartShell(80, 24, newRecordingListener()); sshErrorCode(err) != sshErrClosed {
		t.Errorf("second StartShell = %v, want %s", err, sshErrClosed)
	}
}

func TestSSHKeyboardInteractive(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	srv.configure(func(srv *testSSHServer) { srv.kbdOnly = true })
	client, err := testConnect(t, knownHostsAt(t.TempDir()), srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	client.Close()
}

func TestSSHWrongPassword(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	hosts := knownHostsAt(t.TempDir())
	_, err := testConnect(t, hosts, srv, "nope", "")
	if code := sshErrorCode(err); code != sshErrAuthFailed {
		t.Fatalf("err = %v, want %s", err, sshErrAuthFailed)
	}
	// Failed logins don't pin the host key.
	if key, _ := hosts.lookup(srv.addr); key != nil {
		t.Error("host key remembered after a failed login")
	}
}

func TestSSHPrivateKey(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	userSigner, userPriv := newSigner(t)
	srv.configure(func(srv *testSSHServer) { srv.userKey = userSigner.PublicKey() })

	block, err := ssh.MarshalPrivateKey(userPriv, "")
	if err != nil {
		t.Fatal(err)
	}
	client, err := testConnect(t, knownHostsAt(t.TempDir()), srv, "", string(pem.EncodeToMemory(block)))
	if err != nil {
		t.Fatal(err)
	}
	client.Close()

	encrypted, err := ssh.MarshalPrivateKeyWithPassphrase(userPriv, "", []byte("secret"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = testConnect(t, knownHostsAt(t.TempDir()), srv, "", string(pem.EncodeToMemory(encrypted)))
	if code := sshErrorCode(err); code != sshErrKeyEncrypted {
		t.Errorf("encrypted key: err = %v", err)
	}
	_, err = testConnect(t, knownHostsAt(t.TempDir()), srv, "", "not a key")
	if code := sshErrorCode(err); code != sshErrInvalidKey {
		t.Errorf("garbage key: err = %v", err)
	}
}

func TestSSHHostKeyTrustOnFirstUse(t *testing.T) {
	hostKey, _ := newSigner(t)
	srv := newTestSSHServer(t, hostKey)
	hosts := knownHostsAt(t.TempDir())

	first, err := testConnect(t, hosts, srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	first.Close()
	second, err := testConnect(t, hosts, srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	if second.HostKeyIsNew() {
		t.Error("second connection saw a new host key")
	}
	second.Close()

	// Same address, different machine.
	newHostKey, _ := newSigner(t)
	srv.configure(func(srv *testSSHServer) { srv.hostKey = newHostKey })
	_, err = testConnect(t, hosts, srv, "hunter2", "")
	if code := sshErrorCode(err); code != sshErrHostKeyChanged {
		t.Fatalf("err = %v, want %s", err, sshErrHostKeyChanged)
	}

	if err := hosts.forget(srv.addr); err != nil {
		t.Fatal(err)
	}
	third, err := testConnect(t, hosts, srv, "hunter2", "")
	if err != nil {
		t.Fatal(err)
	}
	if !third.HostKeyIsNew() {
		t.Error("connection after forgetting didn't trust a new key")
	}
	third.Close()
}

func TestSSHUnreachable(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := ln.Addr().String()
	ln.Close()
	_, port, _ := net.SplitHostPort(addr)
	var d net.Dialer
	_, err := connectSSH(context.Background(), d.DialContext, knownHostsAt(t.TempDir()),
		"127.0.0.1", atoiPort(port), "bo", "x", "")
	if code := sshErrorCode(err); code != sshErrUnreachable {
		t.Errorf("err = %v, want %s", err, sshErrUnreachable)
	}
}

func TestKnownHostsFile(t *testing.T) {
	hosts := knownHostsAt(t.TempDir())
	a, _ := newSigner(t)
	b, _ := newSigner(t)
	if err := hosts.add("sol:22", a.PublicKey()); err != nil {
		t.Fatal(err)
	}
	if err := hosts.add("sol:2222", b.PublicKey()); err != nil {
		t.Fatal(err)
	}
	got, _ := hosts.lookup("sol:22")
	if got == nil || !bytes.Equal(got.Marshal(), a.PublicKey().Marshal()) {
		t.Error("sol:22 lookup")
	}
	got, _ = hosts.lookup("sol:2222")
	if got == nil || !bytes.Equal(got.Marshal(), b.PublicKey().Marshal()) {
		t.Error("sol:2222 lookup")
	}
	hosts.forget("sol:2222")
	if got, _ := hosts.lookup("sol:2222"); got != nil {
		t.Error("forget didn't drop sol:2222")
	}
	if got, _ := hosts.lookup("sol:22"); got == nil {
		t.Error("forget dropped sol:22 too")
	}
}
