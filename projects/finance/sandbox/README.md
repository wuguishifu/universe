# finance-sandbox

Scratch project for pulling data out of Plaid before building the real finance dashboard. Everything prints to the console.

## Setup

1. `nx setup environment` writes `.env.local` with `PLAID_CLIENT_ID` and `PLAID_CLIENT_SECRET` from Infisical `/projects/finance/common`.
2. `PLAID_ENV` picks the Plaid environment: `sandbox` (default) or `production`. Plaid issues a different secret for each, so `PLAID_CLIENT_SECRET` has to match.

## Scripts

| Command                    | What it does                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nx seed finance-sandbox`  | Sandbox only. Creates a bank item and an investments item without the Link UI.                                                                                                       |
| `nx link finance-sandbox`  | Serves Plaid Link at <http://localhost:8787>. Pick **Bank / credit card** or **Brokerage / 401(k)**, sign in, and the access token is saved.                                         |
| `nx fetch finance-sandbox` | Fetches accounts, transactions, credit card liabilities, holdings and investment transactions for every linked item. Logs tables and saves the raw JSON to `.data/<env>/snapshots/`. |

`fetch` flags: `nx fetch finance-sandbox --args="--item fidelity"` limits the run to matching items, and `--args="--raw"` dumps the full responses.

Linked items live in `.data/<env>/items.json`, which is gitignored and owner-only. **Those access tokens are long-lived credentials for your real accounts in production.**

## Link products

`src/link-products.ts` decides what each button asks for:

- **Bank / credit card**: `transactions`, plus `liabilities` where supported (Bank of America, Capital One)
- **Brokerage / 401(k)**: `investments` (Fidelity, Schwab, Human Interest, Vestwell)

In production every product is billed per item, and `fetch` only calls the products an item already has. Calling any other product endpoint would add that product to the item and bill it.
