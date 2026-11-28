'use client';

import { useAuthActions } from '@convex-dev/auth/react';
import { useQuery } from 'convex/react';
import { LogOutIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  Button,
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Spinner,
} from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

export function Profile() {
  const viewer = useQuery(api.users.viewer);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          {viewer === undefined ? (
            <Skeleton className="h-4 w-48" />
          ) : (
            (viewer?.email ?? 'No email')
          )}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await signOut();
              router.replace('/sign-in');
            }}
          >
            {signingOut ? <Spinner /> : <LogOutIcon />}
            Sign out
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
