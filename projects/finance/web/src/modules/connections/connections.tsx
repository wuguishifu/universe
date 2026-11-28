'use client';

import { useQuery } from 'convex/react';
import { BriefcaseIcon, LandmarkIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Spinner,
} from '@libs/web-ui';
import { api } from '@platform/convex-contracts';
import type { LinkKind } from '@projects/finance-contracts';

import { createLinkToken, exchangePublicToken } from './actions';
import { ConnectionRow } from './connection-row';
import { openPlaidLink } from './plaid-link';

const LINK_OPTIONS: {
  kind: LinkKind;
  label: string;
  icon: typeof LandmarkIcon;
}[] = [
  { kind: 'bank', label: 'Bank or credit card', icon: LandmarkIcon },
  { kind: 'investments', label: 'Brokerage or 401(k)', icon: BriefcaseIcon },
];

type Status =
  | { state: 'idle' }
  | { state: 'linking'; kind: LinkKind }
  | { state: 'linked'; institutionName: string | null }
  | { state: 'error'; message: string };

/**
 * Linked institutions, from convex, and buttons to link more through Plaid Link. Linking runs in
 * finance-service; this only opens Link and hands its public token over.
 */
export function Connections() {
  const items = useQuery(api.finance.items.list);
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  const link = async (kind: LinkKind) => {
    setStatus({ state: 'linking', kind });
    const token = await createLinkToken(kind);
    if (!token.ok) {
      setStatus({ state: 'error', message: token.message });
      return;
    }

    try {
      await openPlaidLink(token.linkToken, {
        onSuccess: async (publicToken) => {
          const result = await exchangePublicToken({ publicToken, kind });
          setStatus(
            result.ok
              ? { state: 'linked', institutionName: result.institutionName }
              : { state: 'error', message: result.message },
          );
        },
        onExit: (error) =>
          setStatus(
            error
              ? {
                  state: 'error',
                  message: error.display_message ?? error.error_message,
                }
              : { state: 'idle' },
          ),
      });
    } catch (error) {
      setStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>
          Institutions linked through Plaid. Link from a desktop browser: banks
          that sign in through their own site don't work on mobile yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {LINK_OPTIONS.map(({ kind, label, icon: Icon }) => (
            <Button
              key={kind}
              variant="outline"
              disabled={status.state === 'linking'}
              onClick={() => link(kind)}
            >
              {status.state === 'linking' && status.kind === kind ? (
                <Spinner />
              ) : (
                <Icon />
              )}
              <PlusIcon className="-ml-1 size-3" />
              {label}
            </Button>
          ))}
        </div>

        {status.state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        )}
        {status.state === 'linked' && (
          <p role="status" className="text-sm text-muted-foreground">
            Linked {status.institutionName ?? 'the institution'}.
          </p>
        )}

        {items === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nothing linked yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => (
              <ConnectionRow key={item._id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
