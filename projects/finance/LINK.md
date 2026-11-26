# Plaid linking in production

How linking and access tokens should work once the finance dashboard is a real service. The sandbox (`projects/finance/sandbox`) is the prototype of this.

## Terms

- **Item**: one login at one institution (Bank of America, Capital One, Fidelity, Schwab). An item can hold several accounts.
- **Access token**: the credential for an item. It does not expire on its own and is the only thing needed to read that item's data, so treat it like a password.
- **Plaid Link**: the only way to get an access token. There is no separate registration step. Link returns a `public_token`, and the server exchanges it for an `access_token` with `item.exchangePublicToken`.
- **Update mode**: Link opened with an existing item's `access_token`. It fixes a broken login or adds accounts to an item, and usually keeps the same access token.

## Decision

Run Link inside the dashboard and store items in the dashboard's database, with the access token encrypted. Infisical holds only the encryption key.

I decided against keeping access tokens in Infisical because:

- An item comes with state (sync cursor, status, consent expiry) that belongs in the database anyway. Tokens in Infisical would split each item across two places.
- Logins break: password changes, MFA prompts, and OAuth consent that expires after about a year. With tokens in the database, fixing one is a "Reconnect" button. With tokens in Infisical, it's a secret edit and a redeploy.
- Webhooks arrive with an `item_id`, so the server has to look items up by ID.

Infisical tokens would still work for a fixed set of four items. You'd just fix every broken login by hand.

## Data model

One row per item:

| Field                                | Notes                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `item_id`                            | Plaid's ID, unique                                                        |
| `institution_id`, `institution_name` | from `item.get`                                                           |
| `access_token_ciphertext`            | AES-256-GCM, see below                                                    |
| `products`                           | what the item was linked with, which is what we call                      |
| `transactions_cursor`                | from `transactions.sync`. Persist it, don't re-sync from empty every time |
| `status`                             | `ok` / `login_required` / `pending_expiration` / error code               |
| `consent_expiration_time`            | from `item.get`. Warn before it passes                                    |
| `linked_at`, `last_synced_at`        |                                                                           |

Accounts, balances, transactions and holdings get their own tables, keyed by `account_id` / `item_id`.

## Encryption

- Use AES-256-GCM from `node:crypto`, with a random 12-byte IV per token. Store `iv + auth tag + ciphertext`.
- Keep the 32-byte key in Infisical, e.g. `PLAID_TOKEN_KEY`, in the service's secrets path.
- Decrypt only in server code that calls Plaid. If the store is Convex, read tokens only in internal actions and never return them from a query or mutation the client can reach.
- Never log a token or a full Plaid error. Errors can include request headers with the secret. `formatPlaidError` in the sandbox logs only the response body.

## Flows

**Link a new institution**

1. Server: `link.createToken` with the products for that kind (see `sandbox/src/link-products.ts`) and `transactions.days_requested: 730`.
2. Browser: open Link. Its `onSuccess` returns a `public_token`.
3. Server: `item.exchangePublicToken`, then `item.get`, then insert the encrypted row.

**Reconnect** (status `ITEM_LOGIN_REQUIRED`, or consent about to expire)

1. Server: `link.createToken` with `access_token` set and **no** `products`.
2. Browser: open Link. On success there is nothing to exchange, and the access token stays the same.
3. Server: set status back to `ok` and sync.

**Add an account to an existing item**: e.g. when the new 401(k) lands at Fidelity in early 2027.
Use update mode with `update: { account_selection_enabled: true }` so the new account can be selected. Otherwise it may never show up.

**Remove an item**: call `item.remove` (this stops billing), then delete the row and its data.

## Refreshing data

- Start with a cron job every few hours: `accounts.get`, `transactions.sync` from the stored cursor, `liabilities.get`, `investments.getHoldings` / `getTransactions`, each only if the item has that product.
- Webhooks (`SYNC_UPDATES_AVAILABLE`, `ITEM_LOGIN_REQUIRED`, `PENDING_EXPIRATION`, `PENDING_DISCONNECT`) are nice to have. They need a public HTTPS endpoint, and everything sits behind Tailscale, so polling is simpler for now. If you add them, set `webhook` on `link.createToken` and verify the `Plaid-Verification` JWT.
- Plaid's data only refreshes a few times a day, so polling more often than that gains nothing.

## Gotchas

- **Billing**: each product is billed per item. Calling an endpoint for a product the item doesn't have adds that product and bills it, so only call what's in `item.products`.
- **Balances**: `accounts.get` returns cached balances for free. `accounts.getBalance` is real-time and billed per call. Use the cached one.
- **Secrets**: sandbox and production have different secrets. The one in Infisical `/projects/finance/common` was the sandbox secret as of 2026-11-26.
- **OAuth institutions**: BofA, Capital One, Fidelity and Schwab only connect in production after the Plaid dashboard's application profile, company profile and security questionnaire are done.
- **SDK**: `plaid@52` is the new resource-based SDK (`plaid.transactions.sync(...)`, which returns the body directly). Older examples that use `PlaidApi` and `response.data` are for the `plaid/legacy` entry point.
- **Not connected**: Human Interest and Vestwell couldn't be linked. The plan is to roll both 401(k)s into Fidelity once the employer switches providers.
