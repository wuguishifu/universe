# mega-client-service

Downloads MEGA links to the server it runs on. A wrapper around
[MEGAcmd](https://github.com/meganz/MEGAcmd) that serves the SPA ([mega-client-web](../web)) and
pushes live transfer updates to it.

> [!WARNING]
> There's no login of its own: anyone who can reach it can queue downloads to the disk and log the
> server in or out of MEGA. Keep it on the LAN / tailnet.

## How it works

```plaintext
SPA ─► POST /api/transfers, /api/account/... ─► mega-exec get -q | transfers -p/-r/-c | login | logout
                                                  └► answers with a fresh snapshot

While at least one /api/stream client is connected, every 2s:
  mega-exec transfers --show-completed ... ─► parseTransfers() ─► speed + ETA (TransferRates)
  mega-exec whoami (at most every 30s)
  ─► a snapshot, sent over /api/stream (SSE) only if it changed
```

MEGAcmd has no events, so the service still polls, but once for everyone and only while someone
is watching. The parser and the speed estimate live in
[mega-client-contracts](../contracts/src/lib), with tests.

The list shows unfinished transfers in queue order, then the 10 most recently finished. Downloads go
into `DOWNLOAD_PATH`. The MEGA session lives in MEGAcmd's `$HOME/.megaCmd`, so mount `HOME` to
keep it across restarts.

## Running it

The image is built on [mega-node](https://github.com/wuguishifu/mega-node) (Node + MEGAcmd), whose
entrypoint starts `mega-cmd-server`, logs in from `MEGA_EMAIL` + `MEGA_PASSWORD[_FILE]` if there's no
saved session, and falls back to a writable `HOME` for arbitrary uids. See
[docker-compose.example.yml](docker-compose.example.yml).

## Development

1. Install [MEGAcmd](https://mega.io/cmd).
1. Copy [.env.example](.env.example) to `.env` and set `DOWNLOAD_PATH` (and `MEGA_EXEC` on macOS).
1. `nx serve mega-client-service` (port 3010) and `nx dev mega-client-web` (port 4211, proxies `/api`
   to the service).

Tests: `nx test mega-client-contracts` (the MEGAcmd output parser and the speed estimate) and
`nx test mega-client-web` (formatting).
