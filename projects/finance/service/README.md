# finance-service

Links institutions through Plaid for finance-web and keeps their access tokens encrypted in convex.
It's the only place that has Plaid's secret and `PLAID_TOKEN_KEY`, so it's the only place a token
can be read. See [LINK.md](../LINK.md) for why tokens live in convex and how linking works.

## How it works

```plaintext
browser ──► finance-web (Vercel) ── server actions, as the signed-in user
              │  Authorization: Bearer <Convex Auth JWT>   (convexAuthNextjsToken)
              │  CF-Access-Client-Id / -Secret             (Cloudflare tunnel + Access)
              ▼
            finance-service (k8s, tailnet)
              1. ConvexJwtGuard: checks the JWT against ${CONVEX_SITE_URL}/.well-known/jwks.json;
                 the user is the token's subject (<userId>|<sessionId>)
              2. Plaid: link.createToken / item.exchangePublicToken / item.get / item.remove
              3. AES-256-GCM with PLAID_TOKEN_KEY, bound to userId + itemId
              4. convex: api.finance.items.* with FINANCE_CONVEX_SECRET
```

| route                   |                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `POST /api/link-token`  | a Link token for `bank` or `investments` (see `link-products.ts`)                     |
| `POST /api/items`       | exchanges Link's public token and saves the item; removes it at Plaid if saving fails |
| `DELETE /api/items/:id` | `item.remove` at Plaid (stops billing), then deletes the row                          |

The contract is in [finance-contracts](../contracts/src/lib/root.ts). The web app reads items
straight from convex (`api.finance.items.list`), which never returns the ciphertext.

Ciphertexts look like `v1:<iv>:<tag>:<ciphertext>` (base64url). The AAD is
`finance-item:<userId>:<itemId>`, so a ciphertext moved onto another row won't decrypt.
`nx test finance-service` covers this.

## Setup

1. Infisical:
   - `projects/finance/common`: `PLAID_CLIENT_ID`, `PLAID_CLIENT_SECRET`, `PLAID_ENV` (already there
     for finance-sandbox).
   - `projects/finance/service`: `PLAID_TOKEN_KEY` (`openssl rand -base64 32`) and
     `FINANCE_CONVEX_SECRET` (any long random string). Use a different key per environment.
     Losing or changing `PLAID_TOKEN_KEY` makes every stored token unreadable, and every item has
     to be linked again.
2. The convex deployment (dev and prod), from `platform/convex/app`:
   - Convex Auth's keys, from the repo root: `node tools/scripts/convex-auth-keys.mjs` sets `JWT_PRIVATE_KEY` and
     `JWKS` on dev; add `--prod` for prod. Running it again rotates them and signs everyone out.
     (Not `npx @convex-dev/auth`: it would rewrite the auth files that are already set up.)
   - `pnpm nx convex convex-app -- env set FINANCE_CONVEX_SECRET <same value>`
   - `pnpm nx convex convex-app -- env set AUTH_SIGNUP_ALLOWLIST you@example.com`
   - Push the functions (`nx serve convex-app` for dev; the deploy workflow for prod).
3. `nx setup environment` writes `.env.local` (plus `CONVEX_URL` and `CONVEX_SITE_URL` for dev), then
   `nx serve finance-service`. It listens on 3013.

In prod `CONVEX_URL` and `CONVEX_SITE_URL` come from `platform/convex/app`, like the other services.
It runs on the cluster behind the tailnet. finance-web reaches it through the Cloudflare tunnel with
an Access service token. Plaid's webhooks can't reach it through Access, so there are none yet.

## Not built yet

- Syncing (`transactions.sync`, holdings, balances) and the tables for them.
- Reconnecting (Link update mode) for items whose status isn't `ok`. Nothing sets that status yet.
- Linking on mobile web: OAuth institutions need a registered `redirect_uri` and a page that reopens
  Link with `receivedRedirectUri`.
