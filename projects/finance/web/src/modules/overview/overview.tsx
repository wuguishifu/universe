'use client';

import { useQuery } from 'convex/react';
import { TriangleAlertIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Button, Card, CardContent, Skeleton } from '@libs/ui-web';
import { api } from '@platform/convex-contracts';

import { formatMoney, formatPercent, formatRelative, useNow } from '../format';
import { PageHeader } from '../layout/page-header';

import { AccountGroups } from './account-groups';
import { RefreshButton } from './refresh-button';
import { StatTile } from './stat-tile';
import {
  type Group,
  needsAttention,
  summarize,
  TOTAL_CURRENCY,
} from './summarize';

const money = (amount: number) =>
  formatMoney(amount, TOTAL_CURRENCY, { cents: false });

/** The home page: net worth, a tile per kind of account, then every account. */
export function Overview() {
  const overview = useQuery(api.finance.accounts.overview);
  const now = useNow();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const summary = useMemo(
    () => (overview ? summarize(overview.accounts) : undefined),
    [overview],
  );
  const attention = useMemo(
    () => (overview ? needsAttention(overview.items, now) : []),
    [overview, now],
  );
  const lastSyncedAt = overview?.items.reduce<number | null>(
    (latest, item) =>
      item.lastSyncedAt && (!latest || item.lastSyncedAt > latest)
        ? item.lastSyncedAt
        : latest,
    null,
  );
  const hasItems = !!overview?.items.length;

  return (
    <>
      <PageHeader title="Overview">
        {lastSyncedAt && (
          <span className="text-xs text-muted-foreground">
            Updated {formatRelative(lastSyncedAt, now)}
          </span>
        )}
        {hasItems && <RefreshButton onError={setRefreshError} />}
      </PageHeader>

      <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
        {!overview || !summary ? (
          <OverviewSkeleton />
        ) : !hasItems ? (
          <EmptyState />
        ) : (
          <>
            {(attention.length > 0 || refreshError) && (
              <Alerts
                messages={[
                  ...(refreshError ? [refreshError] : []),
                  ...attention.map(({ message }) => message),
                ]}
              />
            )}

            <section aria-label="Net worth" className="space-y-1">
              <p className="text-sm text-muted-foreground">Net worth</p>
              <p className="text-5xl font-semibold tracking-tight tabular-nums">
                {money(summary.netWorth)}
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {money(summary.assets)} in assets · {money(summary.liabilities)}{' '}
                owed
                {summary.excludedCount > 0 &&
                  ` · ${summary.excludedCount} account${summary.excludedCount === 1 ? '' : 's'} not counted (no balance, or not in ${TOTAL_CURRENCY})`}
              </p>
            </section>

            <section
              aria-label="Totals by kind of account"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <GroupTile group={summary.byKey.cash} />
              <GroupTile group={summary.byKey.investments} />
              <GroupTile
                group={summary.byKey.credit}
                detail={
                  summary.creditUtilization !== null
                    ? `${formatPercent(summary.creditUtilization)} of limits used`
                    : undefined
                }
              />
              <GroupTile group={summary.byKey.loans} />
            </section>

            {summary.groups.length > 0 ? (
              <AccountGroups groups={summary.groups} />
            ) : (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No balances yet. Refresh to fetch them.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Balances are as of Plaid&apos;s last update from each institution,
              usually within the last few hours. They refresh here every 6
              hours, or when you press Refresh.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function GroupTile({ group, detail }: { group: Group; detail?: string }) {
  const count = group.accounts.length;
  return (
    <StatTile
      label={group.liability ? `${group.label} owed` : group.label}
      value={money(group.total)}
      muted={count === 0}
      detail={
        detail ??
        (count === 0
          ? 'No accounts'
          : `${count} account${count === 1 ? '' : 's'}`)
      }
    />
  );
}

function Alerts({ messages }: { messages: string[] }) {
  return (
    <Card className="border-destructive/40 py-4">
      <CardContent className="flex gap-3 px-4">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Needs attention</p>
          <ul className="space-y-0.5 text-muted-foreground">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Reconnecting isn&apos;t built yet: disconnect it and link it again
            in{' '}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>
            .
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <p className="font-medium">Nothing linked yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Link a bank, credit card or brokerage to see balances here.
      </p>
      <Button asChild className="mt-4">
        <Link href="/settings">Go to Settings</Link>
      </Button>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
