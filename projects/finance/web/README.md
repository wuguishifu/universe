# finance-web

The finance dashboard. For now: sign in, and link or disconnect institutions under Settings →
Connections. Hosted on Vercel.

- **Auth** is Convex Auth with email and password ([convex/auth.ts](../../../platform/convex/app/convex/auth.ts)).
  Sign-ups are closed: "Create your account" only works for emails in the deployment's
  `AUTH_SIGNUP_ALLOWLIST`. There's no password reset (no email provider).
  [proxy.ts](src/proxy.ts) sends everything but `/sign-in` to `/sign-in` when signed out.
- **Linking** happens in [finance-service](../service/README.md). The server actions in
  [actions.ts](src/modules/connections/actions.ts) forward the user's Convex Auth JWT to it, and the
  browser only opens Plaid Link with the link token it returns. This app never has Plaid's secret or
  the token key.
- **Items** come straight from convex (`api.finance.items.list`), so the list updates on its own after
  linking or disconnecting.

## Setup

1. Infisical `projects/finance/web`: `FINANCE_SERVICE_URL`, plus `CF_ACCESS_CLIENT_ID` and
   `CF_ACCESS_CLIENT_SECRET` for the tunnel. Leave the CF ones unset locally to call the service
   directly (e.g. `http://localhost:3013`).
2. `nx setup environment`, then `nx serve finance-web` (port 4204).
3. Vercel: the same variables plus `NEXT_PUBLIC_CONVEX_URL`, and the ignored build step
   `bash tools/scripts/vercel-ignore.sh finance-web`.

Link from a desktop browser; see finance-service's README for what mobile needs.
