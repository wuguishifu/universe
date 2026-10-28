# sapphire-mobile

A gateway app for services on the tailnet, without running the Tailscale VPN on the phone. The app
embeds its own Tailscale node (`tsnet`, from [`sapphire-proxy`](../proxy)) and routes every WebView
in the app through it, so MagicDNS names (`http://sol:8080`, `https://truenas.<tailnet>.ts.net`)
and `100.x` IPs load as if the phone were on the tailnet.

**Status: rough POC.**

## How it fits together

```
WebView ──(proxy override)──▶ 127.0.0.1:<port> HTTP proxy ──┬─ tailnet host? ─▶ tsnet ─▶ WireGuard/DERP ─▶ sol, truenas, …
                                                            └─ otherwise ────▶ regular network (CDNs, fonts)
```

- [`@projects/sapphire-proxy`](../proxy) is the Go proxy plus the Expo module wrapping its gomobile bindings
  (`Sapphireproxy.xcframework` / `sapphireproxy.aar`). `start()` brings up the node, starts the
  proxy, and points WebViews at it:
  - iOS 17+: `WKWebsiteDataStore.default().proxyConfigurations` (HTTP CONNECT). `react-native-webview`
    uses the default data store unless `incognito`.
  - Android: `androidx.webkit.ProxyController.setProxyOverride`, process-wide.
- A host counts as a tailnet host if it's a `100.64.0.0/10` or `fd7a:115c:a1e0::/48` IP, ends in
  `.ts.net`, or is a bare name with no dots (a MagicDNS short name).
- Android 11+ won't let Go enumerate network interfaces, so the Kotlin side hands the list over from
  `java.net.NetworkInterface` first (`SetInterfaces`), the same workaround as Tailscale's own app.
- Node state lives in Application Support (iOS) / `filesDir` (Android) under `tailscale/`, so login
  persists across launches. The node shows up as `sapphire-mobile` in the admin console.

## Running it

Needs Go, Xcode, and the Android SDK + NDK. The bindings are gitignored; `prebuild` / `run-*` build
them first.

```sh
pnpm nx run sapphire-proxy:build   # gomobile bind → ../proxy/{ios/Frameworks,android/libs}
pnpm nx run sapphire-mobile:run-ios
pnpm nx run sapphire-mobile:run-android
```

`EXPO_PUBLIC_CONVEX_URL` comes from `nx setup environment` (see [`.env.example`](./.env.example)); the
home screen lists the services in the convex `dashboardItems` table, same as sapphire-web.

On first launch, open **Tailnet**, tap **Log in to Tailscale** and approve the node. Then tap a
service, or on the Tailnet screen tap a peer to fill in its URL (add a port if needed) and hit **Go**.

Suggested ACL: tag the node (`tag:sapphire-mobile`) and only allow it the service ports you want
reachable from the phone.

## Notifications

The app also receives notifications from `notifications-service`. On launch (and whenever it comes
back to the foreground) it registers its Expo push token in convex (`notificationDevices`), where
the service reads it. The service runs behind Tailscale, so the app never talks to it directly.
The **Notifications** row on the home screen shows whether the device is registered and lets you
mute channels.

```
any nest/next app ──NotificationsClient──▶ Redis queue ─┐
                                         (or HTTP) ─────┴─▶ notifications-service ──▶ Expo push ──▶ APNs/FCM ──▶ this app
                                                                   │
                                                                   └── reads/prunes devices in convex ◀── this app registers
```

- Channels are defined in `@platform/notifications-contracts/channels`. The app reads them from
  convex (`notifications.channels.list`), so a new channel shows up after a convex deploy, without
  rebuilding the app. Channels are opt-out: a device gets every channel it hasn't muted.
- A notification's `url`, if it has one, opens on tap: a path starting with `/` is a route in this
  app, anything else opens externally.
- On Android, each channel is mirrored as an Android notification channel
  (`src/modules/notifications/android-channels.ts`), which `notifications-service` targets through
  `channelId`.

`EXPO_PUBLIC_NOTIFICATIONS_DEVICE_SECRET` comes from Infisical (`platform/notifications/mobile`)
via `nx setup environment`. It must match `NOTIFICATIONS_DEVICE_SECRET` on the convex deployment.
It's inlined into the app bundle, so it only allows registering a device and changing its own
muted channels. `notifications-service` uses a separate `NOTIFICATIONS_CONVEX_SECRET` to read and
remove devices.

Getting a push token needs an EAS project ID in `app.json` (`extra.eas.projectId`, written by
`eas init` in this directory) and push credentials for `dev.wuguishifu.sapphire`: an APNs key
uploaded to EAS for iOS, and a Firebase project with `google-services.json` plus an FCM V1 key for
Android. Without them the Notifications screen shows the error. `notifications-service`'s
`EXPO_ACCESS_TOKEN` has to belong to the same Expo account.

Push notifications don't work in a simulator, so test on a phone. To send one, use
[`tools/scripts/notifications/send.mjs`](../../../tools/scripts/notifications).

## Vault

The **Vault** row on the home screen is a read-only client for the Vaultwarden server (default
`https://vault.wuguishifu.dev`), plus an AutoFill extension so Safari and other apps can fill from
it. The crypto, storage, and API client live in [`sapphire-vault`](../vault); see its README for how
the keys are stored.

```
app (foreground) ──TailnetProxy URLSession──▶ tsnet ─▶ vault: /api/sync ─▶ encrypted cache (App Group)
AutoFill extension ── Face ID ─▶ user key (shared Keychain) ─▶ decrypts the cache          (no network)
```

- Log in once with the master password (the vault screen asks). After that, Face ID unlocks it.
  The master password is needed again only after a Face ID change, a rejected refresh token, or a
  logout.
- The app syncs when the tailnet comes up and every time it returns to the foreground; sync doesn't
  need Face ID. The extension only ever reads the last synced copy.
- Unlocking decrypts the item list; copying or revealing a password asks for Face ID again. The
  list locks 5 minutes after the app goes to the background.
- Turn the extension on in Settings → General → AutoFill & Passwords → Sapphire. QuickType
  suggestions update each time you unlock the vault in the app.

The extension is the `autofill` target in [`targets/autofill`](./targets/autofill), added at
prebuild by [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets). It links
`SapphireVaultCore` through `pods.rb`. The app and the extension share the App Group
`group.dev.wuguishifu.sapphire` and the Keychain group `<team>.dev.wuguishifu.sapphire.shared`;
the refresh token sits in the app's own Keychain group, which the extension can't read.

The extension is a second bundle ID (`dev.wuguishifu.sapphire.autofill`) with the AutoFill
Credential Provider and App Groups capabilities, so the first `eas build` after adding it asks to
create its provisioning profile.

## Building with EAS

Merging to main builds the app on EAS whenever it's affected:
[`build-mobile-apps`](../../../.github/workflows/build-mobile-apps.yml) runs
[`.eas/workflows/build.yml`](./.eas/workflows/build.yml) (iOS, `production-internal`) and waits for
it. Once the build or update is out, the workflow notifies every device on the `general` channel
through sapphire-web's `POST /api/notifications` (EAS can't reach notifications-service on the
tailnet): a new build links to its EAS page to install it, and an OTA update just says it's on the
way. That needs `SAPPHIRE_WEB_API_TOKEN` (secret visibility) in the `production` EAS environment,
matching sapphire-web's `API_TOKEN`. A failed notification doesn't fail the release.

To build by hand:

```sh
# the build that lives on your phone, pointed at prod convex (same as the merge build)
eas workflow:run .eas/workflows/build.yml

# a dev client pointed at dev convex (pnpm nx start sapphire-mobile to serve it); --local builds on this Mac
pnpm nx build sapphire-mobile -- --profile development --platform ios --local
```

EAS only copies what git tracks, so the proxy bindings and `@platform/convex-contracts` (a
buildable lib whose `dist/` is gitignored) aren't in the build directory. The hooks in
`package.json` build them:

- `eas-build-pre-install` runs `../proxy/build.sh` for `EAS_BUILD_PLATFORM`. It has to run before
  `pod install`, which drops a vendored framework that doesn't exist yet (the build then fails with
  `no such module 'Sapphireproxy'`), and on iOS EAS installs pods before the post-install hook.
  EAS's images don't have Go, so `build.sh` downloads the version in `go.mod` when it runs on EAS.
- `eas-build-post-install` builds `convex-contracts` once dependencies are installed. Any other
  buildable lib the app starts importing needs adding there too.

Builds pin their image, Node, and pnpm in `eas.json`'s `base` profile: the `auto` image picked an
old one for this app (Xcode 15.4, Node 18), and pnpm has to match the root `packageManager` to
read the lockfile.

EAS builds don't read `.env.local`. Each profile names an EAS environment (`development` or
`production`); set `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_NOTIFICATIONS_DEVICE_SECRET` there with
`eas env:create`.

Internal (ad hoc) builds only install on devices registered with `eas device:create` before the
build, and stop launching when their provisioning profile expires (after a year).

## Known gaps

- The merge build is iOS only; Android needs its push setup (Firebase) first.
- iOS suspends the node in the background; it reconnects on foreground in a second or two.
- No tabs or URL bar inside the browser screen.
- The vault is read-only and only handles personal logins: no organization items, other item
  types, passkeys, Argon2id, or two-step login yet.
