// Fetches accounts, transactions, liabilities and investments for every linked item, logs a summary,
// and saves the raw responses to .data/<env>/snapshots/ so you can build against them offline.
//
// Usage: nx fetch finance-sandbox [--args="--item <name or id> --raw"]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { env } from './env.ts';
import { formatPlaidError, Plaid, plaid, plaidErrorCode } from './plaid.ts';
import {
  ensureDataDir,
  itemLabel,
  loadItems,
  type StoredItem,
} from './store.ts';

const { values: args } = parseArgs({
  options: {
    // only fetch items whose institution name or item id contains this
    item: { type: 'string' },
    // also dump the full responses to the console
    raw: { type: 'boolean', default: false },
  },
});

const money = (amount: number | null | undefined, currency?: string | null) =>
  amount == null
    ? '—'
    : amount.toLocaleString('en-US', {
        style: 'currency',
        currency: currency ?? 'USD',
      });

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// full re-sync from an empty cursor every run, this is a sandbox, not the real sync loop
const syncTransactions = async (accessToken: string) => {
  const added: Plaid.Transaction[] = [];
  let cursor: string | undefined;
  for (let attempt = 0; ;) {
    const page = await plaid.transactions.sync({
      access_token: accessToken,
      ...(cursor ? { cursor } : {}),
      count: 500,
    });
    // right after linking, plaid may still be pulling history: wait instead of returning nothing
    if (
      !cursor &&
      page.transactions_update_status === 'NOT_READY' &&
      attempt++ < 10
    ) {
      console.log('  transactions not ready yet, waiting 5s…');
      await sleep(5000);
      continue;
    }
    added.push(...page.added);
    cursor = page.next_cursor;
    if (!page.has_more)
      return { added, status: page.transactions_update_status };
  }
};

const fetchInvestmentTransactions = async (accessToken: string) => {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 90);
  const transactions: Plaid.InvestmentTransaction[] = [];
  const pages = await plaid.investments.getTransactions({
    access_token: accessToken,
    start_date: isoDate(start),
    end_date: isoDate(end),
  });
  for await (const transaction of pages) transactions.push(transaction);
  return transactions;
};

// runs one product's fetch and keeps going if it fails, so one bad product doesn't hide the rest
const attempt = async <T>(label: string, fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (error) {
    const code = plaidErrorCode(error);
    console.log(`  ✗ ${label}: ${formatPlaidError(error)}`);
    if (code === 'ITEM_LOGIN_REQUIRED') {
      console.log('    → this item needs to be relinked through the Link page');
    }
    return undefined;
  }
};

const fetchItem = async (stored: StoredItem) => {
  const { access_token } = stored;
  console.log(`\n━━ ${itemLabel(stored)} · ${stored.kind}`);

  const itemResponse = await attempt('item', () =>
    plaid.item.get({ access_token }),
  );
  if (!itemResponse) return { item_id: stored.item_id };
  const { item } = itemResponse;
  if (item.error) {
    console.log(
      `  ⚠ item error: ${item.error.error_code}: ${item.error.error_message}`,
    );
  }

  // only call the products this item already has: calling another one would add it, and in production bill it
  const products = new Set([...item.products, ...item.billed_products]);
  console.log(`  products: ${[...products].join(', ')}`);

  // cached balances, free to call. accounts.getBalance is real-time but billed per call
  const accounts = await attempt('accounts', () =>
    plaid.accounts.get({ access_token }),
  );
  if (accounts) {
    console.log('\n  Accounts');
    console.table(
      accounts.accounts.map((account) => ({
        name: account.official_name ?? account.name,
        mask: account.mask,
        type: `${account.type}/${account.subtype ?? '—'}`,
        current: money(
          account.balances.current,
          account.balances.iso_currency_code,
        ),
        available: money(
          account.balances.available,
          account.balances.iso_currency_code,
        ),
        limit: money(
          account.balances.limit,
          account.balances.iso_currency_code,
        ),
      })),
    );
  }
  const accountName = (accountId: string) =>
    accounts?.accounts.find((a) => a.account_id === accountId)?.name ??
    accountId;

  const transactions = products.has('transactions')
    ? await attempt('transactions', () => syncTransactions(access_token))
    : undefined;
  if (transactions) {
    const recent = [...transactions.added]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 15);
    console.log(
      `\n  Transactions: ${transactions.added.length} total (${transactions.status}), 15 most recent`,
    );
    console.table(
      recent.map((t) => ({
        date: t.date,
        name: t.merchant_name ?? t.name,
        // plaid amounts are positive for money leaving the account
        amount: money(-t.amount, t.iso_currency_code),
        category: t.personal_finance_category?.primary ?? '—',
        account: accountName(t.account_id),
        pending: t.pending,
      })),
    );
  }

  const liabilities = products.has('liabilities')
    ? await attempt('liabilities', () =>
        plaid.liabilities.get({ access_token }),
      )
    : undefined;
  if (liabilities?.liabilities.credit?.length) {
    console.log('\n  Credit cards');
    console.table(
      liabilities.liabilities.credit.map((card) => ({
        account: card.account_id ? accountName(card.account_id) : '—',
        statement_balance: money(card.last_statement_balance),
        minimum_payment: money(card.minimum_payment_amount),
        due: card.next_payment_due_date ?? '—',
        overdue: card.is_overdue ?? '—',
      })),
    );
  }

  const holdings = products.has('investments')
    ? await attempt('investment holdings', () =>
        plaid.investments.getHoldings({ access_token }),
      )
    : undefined;
  if (holdings) {
    const securities = new Map(
      holdings.securities.map((security) => [security.security_id, security]),
    );
    const total = holdings.holdings.reduce(
      (sum, h) => sum + (h.institution_value ?? 0),
      0,
    );
    console.log(
      `\n  Holdings: ${money(total)} across ${holdings.holdings.length} positions`,
    );
    console.table(
      [...holdings.holdings]
        .sort((a, b) => (b.institution_value ?? 0) - (a.institution_value ?? 0))
        .map((h) => {
          const security = securities.get(h.security_id);
          return {
            account: accountName(h.account_id),
            ticker: security?.ticker_symbol ?? '—',
            name: security?.name ?? h.security_id,
            quantity: h.quantity,
            value: money(h.institution_value, h.iso_currency_code),
            cost_basis: money(h.cost_basis, h.iso_currency_code),
          };
        }),
    );
  }

  const investmentTransactions = products.has('investments')
    ? await attempt('investment transactions', () =>
        fetchInvestmentTransactions(access_token),
      )
    : undefined;
  if (investmentTransactions) {
    console.log(
      `\n  Investment transactions (last 90 days): ${investmentTransactions.length}, 10 most recent`,
    );
    console.table(
      [...investmentTransactions]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 10)
        .map((t) => ({
          date: t.date,
          type: `${t.type}/${t.subtype}`,
          name: t.name,
          quantity: t.quantity,
          amount: money(t.amount, t.iso_currency_code),
        })),
    );
  }

  const snapshot = {
    item_id: stored.item_id,
    institution_name: stored.institution_name,
    item,
    accounts,
    transactions,
    liabilities,
    holdings,
    investmentTransactions,
  };
  if (args.raw) console.dir(snapshot, { depth: null });
  return snapshot;
};

const filter = args.item?.toLowerCase();
const items = loadItems().filter(
  (item) =>
    !filter ||
    item.item_id.toLowerCase().includes(filter) ||
    item.institution_name?.toLowerCase().includes(filter),
);

if (items.length === 0) {
  console.error(
    env.PLAID_ENV === 'sandbox'
      ? 'No items linked yet. Run `nx seed finance-sandbox` or `nx link finance-sandbox` first.'
      : 'No items linked yet. Run `nx link finance-sandbox` first.',
  );
  process.exit(1);
}

console.log(`Fetching ${items.length} item(s) from plaid ${env.PLAID_ENV}`);

// one at a time so the console output stays grouped by institution
const snapshots = [];
for (const item of items) snapshots.push(await fetchItem(item));

const file = join(
  ensureDataDir('snapshots'),
  `${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
writeFileSync(file, `${JSON.stringify(snapshots, null, 2)}\n`, { mode: 0o600 });
console.log(`\nSaved raw responses to ${file}`);
