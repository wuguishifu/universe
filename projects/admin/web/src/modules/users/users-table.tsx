'use client';

import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useState } from 'react';

import { Button, Card, CardContent, Skeleton, Spinner } from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

import { errorMessage, formatDate } from '../format';

type User = FunctionReturnType<typeof api.access.admin.users>[number];

export function UsersTable() {
  const users = useQuery(api.access.admin.users);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          Every account on the deployment. To take someone out of one app,
          revoke that invite on the Access page. Deleting an account signs it
          out everywhere, but leaves its invites, so the email can sign up
          again.
        </p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          {users === undefined ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : users.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No accounts yet.
            </p>
          ) : (
            <ul className="divide-y">
              {users.map((user) => (
                <UserRow key={user.userId} user={user} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UserRow({ user }: { user: User }) {
  const deleteUser = useMutation(api.access.admin.deleteUser);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDelete = async () => {
    if (
      !window.confirm(
        `Delete the account for ${user.email ?? 'this user'}? They'll be signed out everywhere.`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await deleteUser({ userId: user.userId });
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">
          {user.email ?? 'No email'}
          {user.isYou && (
            <span className="font-normal text-muted-foreground"> (you)</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {user.verified ? 'Verified' : 'Unverified'} · joined{' '}
          {formatDate(user.createdAt)}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="hidden flex-wrap justify-end gap-1 sm:flex">
        {user.apps.length === 0 ? (
          <span className="text-xs text-muted-foreground">No apps</span>
        ) : (
          user.apps.map((app) => (
            <span
              key={app}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
            >
              {app}
            </span>
          ))
        )}
      </div>
      {!user.isYou && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={pending}
          className="text-destructive hover:text-destructive"
        >
          {pending && <Spinner />}
          Delete
        </Button>
      )}
    </li>
  );
}
