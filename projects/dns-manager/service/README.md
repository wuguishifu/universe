# dns-manager-service

Keeps Cloudflare DNS in sync with the services the TrueNAS box serves. It reads the hosts from the
NAS's Traefik and writes them into a `DNSEndpoint` that
[external-dns](https://github.com/kubernetes-sigs/external-dns) (in the homelab cluster) turns
into Cloudflare records. It never talks to Cloudflare itself, so external-dns stays the only thing
writing the zone: it owns the records (TXT registry) and deletes them when they go away.

## How it works

```plaintext
SyncService (every SYNC_INTERVAL_SECONDS, never overlapping)
  1. NAS Traefik GET /api/http/routers (every page): the hosts of every enabled router's Host() rule
  2. each host under DOMAIN ─► an endpoint (see buildEndpoints in records.ts)
       jellyfin.wuguishifu.dev     A      TAILNET_TARGET (the NAS's Tailscale IP)
       jellyfin-gw.wuguishifu.dev  CNAME  GATEWAY_TARGET (the NAS's tunnel), proxied
  3. hosts gone from Traefik are kept for REMOVAL_GRACE_SECONDS, so a container restart doesn't
     drop its record
  4. server-side apply of DNSEndpoint DNS_ENDPOINT_NAMESPACE/DNS_ENDPOINT_NAME, if anything changed
       ─► external-dns ─► Cloudflare
```

Adding a Traefik router on the NAS is the whole workflow: a `Host()` gets a tailnet record, and a
`-gw` host is published through the NAS's Cloudflare Tunnel.

**Anything going wrong leaves DNS as it is.** If Traefik can't be reached, errors, or reports no
`Host()` routers at all (more likely a broken provider than an empty NAS), the sync fails and the
`DNSEndpoint` isn't touched. The flip side: removing the NAS's last router doesn't remove its
record; delete that one by hand.

Skipped hosts are logged (once, when the list changes) and shown in `GET /api/status`:

- not under `DOMAIN`, or not a plain hostname
- a gateway host deeper than one level (`a-gw.b.wuguishifu.dev`): Cloudflare's Universal SSL
  only covers `*.wuguishifu.dev`, so it would get no edge certificate
- a gateway host while `GATEWAY_TARGET` is unset

`GET /api/status` also shows the managed endpoints, hosts waiting out the grace period, and the
last sync's time and error.

## Running it locally

Copy `.env.example` to `.env.local`, point `TRAEFIK_API_URL` at the NAS, and `nx serve
dns-manager-service`. With `DRY_RUN=true` it logs what it would apply. To apply for real, run
`kubectl proxy` and set `KUBE_API_URL=http://127.0.0.1:8001` (and `DRY_RUN=false`).

`nx test dns-manager-service` runs the tests for the routing rules (`records.spec.ts`).

## Deploying (homelab)

Needs external-dns running with `--source=crd` (plus its `DNSEndpoint` CRD), Cloudflare provider,
TXT registry. The pod's service account needs `get` and `patch` on `dnsendpoints` in
`DNS_ENDPOINT_NAMESPACE`: server-side apply creates the object the first time.

On the NAS:

- Traefik's API on the tailnet (`api.insecure`, or a router to `api@internal` with basic auth;
  set `TRAEFIK_API_USERNAME`/`TRAEFIK_API_PASSWORD`).
- For gateway hosts: its own Cloudflare Tunnel (not a second connector of the cluster's tunnel;
  connectors of one tunnel are interchangeable, so they can't route differently) with a catch-all
  rule to Traefik. cloudflared speaks plain HTTP to Traefik, so `-gw` routers must be on the
  `web` entrypoint.

**Migrating from hand-made records:** external-dns won't take over a record it didn't create. It
skips that name and logs the conflict, so delete each NAS service's hand-made Cloudflare record
once and external-dns recreates it within a sync.

## Known limitations

- HTTP routers only (`/api/tcp/routers` and `HostSNI` aren't read).
- A negation of a group, `!(Host(a) || Host(b))`, isn't understood: its hosts are treated as
  matched. `!Host(a)` on its own is.
- The grace period is kept in memory, so a restart starts it over (it only ever delays removals).
- One Traefik per instance. Another source would be another instance with its own
  `DNS_ENDPOINT_NAME`.
