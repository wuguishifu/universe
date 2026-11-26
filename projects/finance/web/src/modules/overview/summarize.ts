import type { FunctionReturnType } from 'convex/server';

import type { api } from '@platform/convex-contracts';

export type Overview = FunctionReturnType<typeof api.finance.accounts.overview>;
export type OverviewAccount = Overview['accounts'][number];
export type OverviewItem = Overview['items'][number];

export type GroupKey = 'cash' | 'investments' | 'credit' | 'loans' | 'other';

/** In display order. */
export const GROUP_ORDER: GroupKey[] = [
  'cash',
  'investments',
  'credit',
  'loans',
  'other',
];

/** Totals are in this currency only; accounts in others are listed but not added up. */
export const TOTAL_CURRENCY = 'USD';

export function groupOf(type: string): GroupKey {
  switch (type) {
    case 'depository':
      return 'cash';
    case 'investment':
    case 'brokerage':
      return 'investments';
    case 'credit':
      return 'credit';
    case 'loan':
      return 'loans';
    default:
      return 'other';
  }
}

/** Plaid sets one of the two; treat neither as USD. */
export const currencyOf = (account: OverviewAccount): string =>
  account.isoCurrencyCode ?? account.unofficialCurrencyCode ?? 'USD';

/** Whether an account's balance goes into the totals. */
const counts = (
  account: OverviewAccount,
): account is OverviewAccount & {
  current: number;
} => account.current !== null && currencyOf(account) === TOTAL_CURRENCY;

export type Group = {
  key: GroupKey;
  label: string;
  /** For liabilities, Plaid's `current` is what's owed. */
  liability: boolean;
  accounts: OverviewAccount[];
  /** Sum of `current` over the accounts that count. */
  total: number;
};

const emptyGroup = (
  key: GroupKey,
  label: string,
  liability: boolean,
): Group => ({ key, label, liability, accounts: [], total: 0 });

export type Summary = {
  /** Only the groups with accounts. */
  groups: Group[];
  byKey: Record<GroupKey, Group>;
  assets: number;
  liabilities: number;
  netWorth: number;
  /** Credit card balances over their limits, for the cards that report one. */
  creditUtilization: number | null;
  /** Accounts left out of the totals: another currency, or no balance. */
  excludedCount: number;
};

export function summarize(accounts: OverviewAccount[]): Summary {
  const byKey: Record<GroupKey, Group> = {
    cash: emptyGroup('cash', 'Cash', false),
    investments: emptyGroup('investments', 'Investments', false),
    credit: emptyGroup('credit', 'Credit cards', true),
    loans: emptyGroup('loans', 'Loans', true),
    other: emptyGroup('other', 'Other', false),
  };

  let excludedCount = 0;
  let creditUsed = 0;
  let creditLimit = 0;
  for (const account of accounts) {
    const group = byKey[groupOf(account.type)];
    group.accounts.push(account);
    if (!counts(account)) {
      excludedCount++;
      continue;
    }
    group.total += account.current;
    if (group.key === 'credit' && account.limit) {
      creditUsed += account.current;
      creditLimit += account.limit;
    }
  }

  for (const group of Object.values(byKey)) {
    group.accounts.sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
  }
  const groups = GROUP_ORDER.map((key) => byKey[key]).filter(
    (group) => group.accounts.length > 0,
  );
  const sum = (liability: boolean) =>
    groups
      .filter((group) => group.liability === liability)
      .reduce((total, group) => total + group.total, 0);
  const assets = sum(false);
  const liabilities = sum(true);

  return {
    groups,
    byKey,
    assets,
    liabilities,
    netWorth: assets - liabilities,
    creditUtilization: creditLimit > 0 ? creditUsed / creditLimit : null,
    excludedCount,
  };
}

/** How many days until an item's OAuth consent runs out, when that's soon. */
export const CONSENT_WARNING_DAYS = 14;

export type Attention = { item: OverviewItem; message: string };

/** Items that need doing something about, and what. */
export function needsAttention(
  items: OverviewItem[],
  now: number,
): Attention[] {
  return items.flatMap((item): Attention[] => {
    const name = item.institutionName ?? 'An institution';
    if (item.status === 'login_required') {
      return [{ item, message: `${name} needs you to log in again.` }];
    }
    if (item.status === 'error') {
      return [
        {
          item,
          message: `${name} couldn't be refreshed${item.errorCode ? ` (${item.errorCode})` : ''}.`,
        },
      ];
    }
    if (item.consentExpirationTime) {
      const days = Math.ceil(
        (item.consentExpirationTime - now) / (24 * 60 * 60 * 1000),
      );
      if (days <= CONSENT_WARNING_DAYS) {
        return [
          {
            item,
            message:
              days > 0
                ? `${name}'s access expires in ${days} day${days === 1 ? '' : 's'}.`
                : `${name}'s access has expired.`,
          },
        ];
      }
    }
    return [];
  });
}
