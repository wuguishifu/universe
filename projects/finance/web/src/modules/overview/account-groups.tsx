import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@libs/ui-web';

import { formatMoney, formatPercent } from '../format';

import { Meter } from './meter';
import {
  currencyOf,
  type Group,
  type OverviewAccount,
  TOTAL_CURRENCY,
} from './summarize';

/** Every account, a card per group, biggest balance first. */
export function AccountGroups({ groups }: { groups: Group[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
            <CardAction className="text-sm font-medium tabular-nums">
              {formatMoney(group.total, TOTAL_CURRENCY)}
              {group.liability && (
                <span className="font-normal text-muted-foreground"> owed</span>
              )}
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {group.accounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AccountRow({ account }: { account: OverviewAccount }) {
  const currency = currencyOf(account);
  const utilization =
    account.type === 'credit' && account.limit && account.current !== null
      ? account.current / account.limit
      : null;
  const details = [
    account.institutionName,
    account.mask && `••${account.mask}`,
    account.subtype,
  ].filter(Boolean);

  return (
    <li className="space-y-2 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {details.join(' · ')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium tabular-nums">
            {account.current === null
              ? '—'
              : formatMoney(account.current, currency)}
          </p>
          <SecondaryBalance account={account} currency={currency} />
        </div>
      </div>
      {utilization !== null && account.limit && (
        <div className="space-y-1">
          <Meter value={utilization} label={`${account.name} credit used`} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatPercent(utilization)} of{' '}
            {formatMoney(account.limit, currency, { cents: false })} limit
          </p>
        </div>
      )}
    </li>
  );
}

/** Available balance for cash when it differs (pending transactions), available credit for lines of credit. */
function SecondaryBalance({
  account,
  currency,
}: {
  account: OverviewAccount;
  currency: string;
}) {
  if (account.available === null || account.available === account.current) {
    return null;
  }
  if (account.type === 'depository') {
    return (
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatMoney(account.available, currency)} available
      </p>
    );
  }
  if (account.type === 'loan' && account.limit) {
    return (
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatMoney(account.available, currency)} available to draw
      </p>
    );
  }
  return null;
}
