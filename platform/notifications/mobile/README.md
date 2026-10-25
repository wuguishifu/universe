# notifications-mobile

Receives notifications from `notifications-service`. On launch (and whenever it comes back to the
foreground) it registers its Expo push token in convex (`notificationDevices`), where the service
reads it. The service runs behind Tailscale, so the app never talks to it directly.

The one screen shows whether the device is registered and lets you mute channels.

## How it fits together

```
any nest app ──NotificationsClient──▶ Redis queue ─┐
                                    (or HTTP) ─────┴─▶ notifications-service ──▶ Expo push ──▶ APNs/FCM ──▶ this app
                                                              │
                                                              └── reads/prunes devices in convex ◀── this app registers
```

- Channels are defined in `@platform/notifications-contracts/channels`. The app reads them from
  convex (`notifications.channels.list`), so a new channel shows up after a convex deploy, without
  rebuilding the app. Channels are opt-out: a device gets every channel it hasn't muted.
- A notification's `url`, if it has one, opens on tap: a path starting with `/` is a route in this
  app, anything else opens externally.

## Environment

| Variable                                  | Where it comes from                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `EXPO_PUBLIC_CONVEX_URL`                  | `nx setup environment` locally; the EAS environment for builds              |
| `EXPO_PUBLIC_NOTIFICATIONS_DEVICE_SECRET` | Infisical (`platform/notifications/mobile`); the EAS environment for builds |

The device secret must match `NOTIFICATIONS_DEVICE_SECRET` on the convex deployment. It's inlined
into the app bundle, so it only allows registering a device and changing its own muted channels.
`notifications-service` uses a separate `NOTIFICATIONS_CONVEX_SECRET` to read and remove devices.

Each EAS build profile names an EAS environment (`development` or `production`). Set the variables
there with `eas env:create`, so they're never committed.

## One-time setup

1. `eas login`, then `eas init` in this directory. That writes the EAS project ID into `app.json`
   (`extra.eas.projectId`), which the app needs to get a push token.
2. `eas device:create` and install the profile on your phone, so ad hoc builds will install on it.
3. On the first iOS build, let EAS create the distribution certificate, the provisioning profile,
   and the push key (APNs).
4. In the Expo dashboard, turn on enhanced push security for the project, create an access token,
   and set it as `EXPO_ACCESS_TOKEN` for `notifications-service`.
5. Set `NOTIFICATIONS_DEVICE_SECRET` and `NOTIFICATIONS_CONVEX_SECRET` on both convex deployments
   (`pnpm nx convex convex-app -- env set <NAME> <value>`, with `--prod` for production).
6. Set `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_NOTIFICATIONS_DEVICE_SECRET` in both EAS
   environments.

## Building

```sh
# a dev client pointed at dev convex, for working on the app (pnpm nx start notifications-mobile to serve it)
eas build --profile development --platform ios

# the build that lives on your phone, pointed at prod convex
eas build --profile production-internal --platform ios
```

EAS only uploads what git tracks, so `@platform/convex-contracts` (a buildable lib whose `dist/`
is gitignored) isn't there on the build machine. `eas-build-post-install` in `package.json` builds
it after EAS installs dependencies. Any other buildable lib the app starts importing needs adding
there too.

Ad hoc builds stop launching when their provisioning profile expires (after a year), and a new
device only gets builds made after it's registered with `eas device:create`.

Push notifications don't work in a simulator or in Expo Go, so test on a phone with a dev client.
To send one, use [`tools/scripts/notifications/send.mjs`](../../../tools/scripts/notifications).

## TODO: Android

The code already supports Android: it registers with `platform: 'android'`, and it mirrors each
channel as an Android notification channel (`src/modules/notifications/android-channels.ts`),
which `notifications-service` targets through `channelId`. What's missing is the setup:

- [ ] Create a Firebase project and add an Android app with the package name
      `dev.wuguishifu.notifications`.
- [ ] Download its `google-services.json` into this directory and point to it in `app.json`
      (`expo.android.googleServicesFile: "./google-services.json"`). It identifies the Firebase
      project but isn't a secret.
- [ ] In Firebase, create a service account key for FCM V1 and upload it to EAS (`eas credentials` > Android > Google Service Account > FCM V1). Expo uses it to send through FCM.
- [ ] Build with `eas build --profile production-internal --platform android` (both profiles
      already build an installable APK) and install it from the link EAS gives you.
- [ ] Check that a test notification arrives, that the channel shows up under the app's
      notification settings in Android, and that tapping it opens its `url`.

Until that's done, an Android build fails to get a push token and shows the error on its screen.
