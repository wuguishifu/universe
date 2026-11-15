# sapphire-ssh

SSH to tailnet machines from [`sapphire-mobile`](../mobile), without the Tailscale VPN. The client
is Go (`golang.org/x/crypto/ssh`, in [`sapphire-proxy`](../proxy)'s gomobile framework) and dials
through the same embedded tsnet node the WebViews use, so MagicDNS names and `100.x` IPs just work.
This package is the iOS Expo module around it: saved logins, Face ID, and vault keys.

**Scope (v1):** iOS, interactive shells (no port forwarding, agent forwarding or SFTP), password,
keyboard-interactive (answered with the password) and unencrypted private keys.

## Layout

- `ios/SapphireSshModule.swift`: the `SapphireSsh` Expo module: profiles, connecting, sessions.
- `ios/SshProfiles.swift`: saved machines (UserDefaults) and their passwords (Keychain).
- `index.ts`: the typed JS API.
- The Go client is `../proxy/ssh.go`; `../proxy/ios/TailnetSsh.swift` wraps its gomobile bindings.

## Credentials

```plaintext
new login:    password typed in JS ─▶ Go connect ─(accepted)─▶ Keychain, .biometryCurrentSet
saved login:  Face ID ─▶ Keychain ─▶ Go connect                                (never in JS)
vault key:    Face ID ─▶ vault user key ─▶ decrypt the SSH key item ─▶ Go connect   (never in JS)
```

- A profile is `user@host:port`. It's saved only once the server accepts the credentials, so a
  typo never gets remembered. Logging in again as the same user replaces it.
- Passwords live in the app's own Keychain group (not the one shared with AutoFill) under the
  `dev.wuguishifu.sapphire.ssh` service, readable only with Face ID, on this device only.
  Changing Face ID enrollment destroys them; the profile then asks for the password again.
- Vault keys are [Bitwarden SSH key items](https://bitwarden.com/help/ssh-keys/) (cipher type 5),
  read from the vault's synced cache. The profile keeps the item id, not the key, so rotating the
  key in Bitwarden (and syncing) is all it takes. Passphrase-protected keys aren't supported;
  Bitwarden stores imported keys without one.

## Host keys

Trust on first use, like `ssh` with `StrictHostKeyChecking=accept-new`: the first key a machine
presents is remembered (in `known_hosts` next to the tsnet state) once login succeeds, and a
different key later fails with `ERR_SSH_HOST_KEY_CHANGED`. The app shows both fingerprints and can
forget the old key. The tailnet already authenticates the machine (WireGuard keys tied to its
MagicDNS name), so this guards against a reused name or IP more than against a network attacker.

## Sessions

`connect`/`connectProfile` authenticate and return a session id; `startShell(id, cols, rows)` then
opens an `xterm-256color` PTY. The split lets the terminal measure itself first, so the shell starts
at the right size and no output arrives before JS is listening. Output is batched for 8ms and
crosses the bridge as base64 (chunks can split UTF-8 sequences; xterm.js reassembles them).
A keepalive every 30s notices dead connections, e.g. after the app was suspended.

The terminal itself (xterm.js in a WebView, and the key bar) is in
`../mobile/src/modules/ssh`.
