'use client';

import { useAuthActions } from '@convex-dev/auth/react';
import { useQuery } from 'convex/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Spinner,
} from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

import { DEFAULT_SIGN_IN_PATH } from './paths';

/**
 * For the app's no-access page, where the proxy sends someone who's signed in but has no grant for
 * the app. Lets them sign out to try another account.
 */
export function NoAccess({
  appName,
  signInPath = DEFAULT_SIGN_IN_PATH,
}: {
  appName: string;
  signInPath?: string;
}) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const viewer = useQuery(api.users.viewer);
  const [pending, setPending] = useState(false);

  const onSignOut = async () => {
    setPending(true);
    try {
      await signOut();
    } finally {
      router.replace(signInPath);
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>You don&apos;t have access</CardTitle>
        <CardDescription>
          {viewer?.email ? (
            <>
              <span className="font-medium text-foreground">
                {viewer.email}
              </span>{' '}
              isn&apos;t invited to {appName}.
            </>
          ) : (
            <>This account isn&apos;t invited to {appName}.</>
          )}{' '}
          Ask for an invite, or sign in with a different account.
        </CardDescription>
      </CardHeader>
      <CardFooter className="mt-6">
        <Button className="w-full" onClick={onSignOut} disabled={pending}>
          {pending && <Spinner />}
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}
