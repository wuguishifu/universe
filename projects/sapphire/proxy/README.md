# sapphire-proxy

Go library, bound with gomobile, that embeds a userspace Tailscale node (`tailscale.com/tsnet`) and
serves a localhost HTTP proxy (CONNECT + absolute-URI) in front of it. The same directory is also the
`@projects/sapphire-proxy` Expo module that [`sapphire-mobile`](../mobile) depends on:

- `*.go`: the Go package that gomobile binds
- `ios/`, `android/`: the Swift/Kotlin Expo module wrapping the bindings (`ios/Frameworks` and
  `android/libs` hold the gitignored gomobile output)
- `index.ts`: the typed JS API

Exported API (gomobile-safe types only): `Start(dir, hostname)`, `Stop()`, `ProxyPort()`,
`Status()` (JSON), `Logout()`, `RecentLogs()`, `SetInterfaces(spec)` (Android).

```sh
pnpm nx run sapphire-proxy:build-ios      # → ios/Frameworks
pnpm nx run sapphire-proxy:build-android  # → android/libs
pnpm nx run sapphire-proxy:test
```

`build.sh` installs `gomobile` if it's missing. Android picks the newest NDK under `$ANDROID_HOME/ndk`
unless `ANDROID_NDK_HOME` is set.
