# sapphire-vault

A read-only Vaultwarden client for [`sapphire-mobile`](../mobile) and its AutoFill extension. The
app syncs the vault over the tailnet; the extension fills passwords from that synced copy, so it
never needs the tailnet (or the VPN slot) itself.

**Scope (v1):** iOS, personal login items (username, password, URIs, TOTP) and SSH keys (for
[`sapphire-ssh`](../ssh); kept apart from logins, so they never show up in AutoFill), PBKDF2
accounts without two-step login. Organization items, the trash, cards/identities/notes, passkeys, Argon2id and 2FA
aren't supported. Nothing is written back to the server yet; `EncString.encrypt` exists (and is
tested by round trip) for adding items later.

## Layout

- `ios/Core/`: the `SapphireVaultCore` pod. Plain Swift, no Expo, so the AutoFill extension links
  it directly (`mobile/targets/autofill/pods.rb`). `Package.swift` builds the same sources for
  `swift test` on macOS.
- `ios/SapphireVaultModule.swift`: the `SapphireVault` Expo module the app uses.
- `index.ts`: the typed JS API.
- `tests/`: XCTest, including fixtures captured from a throwaway account.

## How unlocking works

```plaintext
login (once):  master password ─PBKDF2─▶ master key ─HKDF─▶ stretched key ─decrypts─▶ user key
                                              └─PBKDF2(1)─▶ password hash ─▶ /identity/connect/token
storage:       user key      → Keychain, shared group, .biometryCurrentSet + ThisDeviceOnly
               refresh token → Keychain, app-only group, AfterFirstUnlockThisDeviceOnly
               /api/sync     → App Group container, still encrypted, .completeFileProtection
sync:          refresh token → access token → /api/sync → cache       (no Face ID)
unlock:        Face ID → user key → decrypt summaries (names, usernames, URIs)
copy/reveal:   Face ID → user key → decrypt one password / TOTP secret
```

- **The user key is never kept in memory.** Each operation that needs it (unlocking the list,
  copying or revealing a password, copying a code) reads it from the Keychain, which prompts for
  Face ID, and drops it. The one exception is the AutoFill extension, which keeps the key from its
  single Face ID until it fills or is canceled, since each launch exists for one fill.
- **Face ID changes destroy the key** (`.biometryCurrentSet`). The app then asks for the master
  password again.
- **Vaultwarden has no token revocation endpoint**, so logging out only wipes this device: the
  Keychain items, the cache, and the AutoFill suggestions. The device stays in the account's device
  list; the device identifier is kept, so logging in again reuses that entry.
- SSH private keys never pass through JS either: `sshKeys` returns names, public keys and
  fingerprints, and `sapphire-ssh` decrypts the private key natively when it connects.
- Passwords copy to the pasteboard as `localOnly` (no Universal Clipboard) with a 60s expiry, and
  never pass through JS. `reveal` is the only call that hands secrets to JS.

API calls go through the tailnet: `TailnetProxy.session()` (from `sapphire-proxy`) is a URLSession
pointed at the same local proxy the WebViews use.

## URI matching

`UriMatcher` ports Bitwarden's match detection (base domain, host, starts with, exact, regular
expression, never), without equivalent domains. Base domains come from the ICANN section of the
public suffix list in `ios/Core/Resources`, which is what Bitwarden's clients use (tldts ignores the
private section). Refresh it with `nx run sapphire-vault:update-public-suffix-list`.

QuickType suggestions register base-domain and host URIs as domains, starts-with and exact URIs as
URLs, and skip regex and never. They're replaced each time the app unlocks the vault, since
usernames and URIs are encrypted.

## Tests

```sh
pnpm nx run sapphire-vault:test   # swift test
```

The unit tests use RFC 6238 TOTP vectors, KDF/encryption vectors computed independently with
Node's crypto, a URI matching table, and synthetic sync responses.

`FixtureTests` runs the real read path against responses from a throwaway account on the vault
(skipped until they exist). To re-capture, with the Mac on the tailnet:

```sh
nx setup environment                         # writes .env.local from Infisical projects/sapphire/vault
pnpm nx run sapphire-vault:capture-fixtures  # VAULT_TEST_EMAIL, VAULT_TEST_MASTER_PASSWORD
```

The captured files (`account.json`, `prelogin.json`, `token.json`, `sync.json`,
`master-password-hash.txt`) are gitignored, since together they're enough to decrypt the account,
so each machine captures its own. Access and refresh tokens are stripped. Only
`Fixtures/expected.json` is committed, and it must match the account's items:

| Name          | Username              | Password             | URIs (match)                                                 | TOTP                                                                                                      |
| ------------- | --------------------- | -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GitHub` ★    | `octocat@example.com` | `gh-test-password-1` | `https://github.com` (default)                               | `JBSWY3DPEHPK3PXP`                                                                                        |
| `Host Match`  | `host-user`           | `host-pass`          | `https://login.example.co.uk:8443` (host)                    |                                                                                                           |
| `Exact Match` | `exact-user`          | `exact-pass`         | `https://example.org/login` (exact), `example.net` (default) |                                                                                                           |
| `No Username` |                       | `only-a-password`    |                                                              |                                                                                                           |
| `Café ☕`     | `ünïcødé`             | `pässwörd-✓`         | `https://unicode.example.com/a` (starts with)                | `otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example&digits=8&period=60&algorithm=SHA256` |

Plus a secure note `Ignored Note` and a login `Deleted Item` in the trash, which must be filtered
out.
