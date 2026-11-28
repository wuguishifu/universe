'use client';

import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { type FormEvent, useState } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
  Spinner,
} from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

import { errorMessage, formatDate } from '../format';

type AppAccess = FunctionReturnType<typeof api.access.admin.apps>[number];
type Grant = AppAccess['grants'][number];

export function AccessOverview() {
  const apps = useQuery(api.access.admin.apps);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Access</h1>
        <p className="text-sm text-muted-foreground">
          Invite an email to an app to let it sign up and use that app. Accounts
          are shared across apps, so each invite only opens the one app.
        </p>
      </div>
      {apps === undefined
        ? [0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-40 w-full rounded-xl" />
          ))
        : apps.map((app) => <AppAccessCard key={app.app} app={app} />)}
    </div>
  );
}

function AppAccessCard({ app }: { app: AppAccess }) {
  const grant = useMutation(api.access.admin.grant);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email') ?? '');
    setPending(true);
    setError(null);
    try {
      await grant({ email, app: app.app });
      form.reset();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{app.label}</CardTitle>
        <CardDescription>
          <code>{app.app}</code> · {app.grants.length}{' '}
          {app.grants.length === 1 ? 'person' : 'people'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onInvite} className="flex gap-2">
          <Input
            name="email"
            type="email"
            placeholder="friend@example.com"
            aria-label={`Email to invite to ${app.label}`}
            required
          />
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Invite
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {app.grants.length > 0 && (
          <ul className="divide-y rounded-md border">
            {app.grants.map((grant) => (
              <GrantRow key={grant.grantId} grant={grant} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ACCOUNT_LABELS: Record<Grant['account'], string> = {
  none: 'Not signed up',
  unverified: 'Unverified',
  verified: 'Signed up',
};

function GrantRow({ grant }: { grant: Grant }) {
  const revoke = useMutation(api.access.admin.revoke);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRevoke = async () => {
    setPending(true);
    setError(null);
    try {
      await revoke({ grantId: grant.grantId });
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {grant.email}
          {grant.isYou && (
            <span className="font-normal text-muted-foreground"> (you)</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {ACCOUNT_LABELS[grant.account]} · invited{' '}
          {formatDate(grant.grantedAt)}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRevoke}
        disabled={pending}
        className="text-destructive hover:text-destructive"
      >
        {pending && <Spinner />}
        Revoke
      </Button>
    </li>
  );
}
