# notifications

Sends a notification through [notifications-service](../../../platform/notifications/service), to
every device running [notifications-mobile](../../../platform/notifications/mobile) that hasn't
muted the channel. Handy for testing the app, and for anything outside the cluster that wants to
send one from a shell.

It POSTs to the service's `/api/notifications`, so it needs Tailscale up. `NOTIFICATIONS_SERVICE_URL`
and `NOTIFICATIONS_SERVICE_API_TOKEN` come from this folder's `.env.local`, which `nx setup environment`
writes from Infisical's `platform/notifications/client` (the same variables apps using
`NotificationsClient`'s http transport read). `--service-url` and `--token` override them.

```sh
node tools/scripts/notifications/send.mjs "Hello"
node tools/scripts/notifications/send.mjs "Backup finished" "312 files, 4.2GB" --channel general

# open something on tap: a path is a route in the app, a URL opens in the browser
node tools/scripts/notifications/send.mjs "Run done" --url https://wuguishifu.dev

# no sound, and only one on the lock screen however many times it's sent
node tools/scripts/notifications/send.mjs "Still hot" --silent --collapse-id thermo-alert

# see what would be sent
node tools/scripts/notifications/send.mjs "Hello" --data '{"runId":"abc"}' --dry-run
```

Run it with no arguments for every option. The service validates the notification, so a channel
that doesn't exist or a bad `--priority` comes back as a 400 listing what's wrong.
