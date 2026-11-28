# finance-web

The finance dashboard. For now: sign in, and link or disconnect institutions under Settings →
Connections. Hosted on Vercel.

- **Auth** is the shared invite-only Convex Auth from [@libs/web-auth](../../../libs/web/auth/README.md):
  email and password, with emailed codes to verify the address and reset a password. Only emails with
  a `finance` grant (invite them in admin-web) can use the app. [proxy.ts](src/proxy.ts) sends
  signed-out visitors to `/sign-in` and anyone without the grant to `/no-access`. The convex queries
  (`finance.*`) and finance-service check the grant too.
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
