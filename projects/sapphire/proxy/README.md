# sapphire-proxy

Go library, bound with gomobile, that embeds a userspace Tailscale node (`tailscale.com/tsnet`) and
serves a localhost HTTP proxy (CONNECT + absolute-URI) in front of it. Used by
[`sapphire-mobile`](../mobile) through its `modules/sapphire-proxy` Expo module.

Exported API (gomobile-safe types only): `Start(dir, hostname)`, `Stop()`, `ProxyPort()`,
`Status()` (JSON), `Logout()`, `RecentLogs()`, `SetInterfaces(spec)` (Android).

```sh
pnpm nx run sapphire-proxy:build-ios      # → ../mobile/modules/sapphire-proxy/ios/Frameworks
pnpm nx run sapphire-proxy:build-android  # → ../mobile/modules/sapphire-proxy/android/libs
pnpm nx run sapphire-proxy:test
```

`build.sh` installs `gomobile` if it's missing. Android picks the newest NDK under `$ANDROID_HOME/ndk`
unless `ANDROID_NDK_HOME` is set.
