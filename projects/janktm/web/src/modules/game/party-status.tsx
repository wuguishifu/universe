import Link from 'next/link';

import { Button, Spinner } from '@libs/web-ui';

/** What to show while a party is loading, failed to load, or doesn't exist. */
export function PartyStatus({
  code,
  isError,
  isPending,
}: {
  code: string;
  isError: boolean;
  isPending: boolean;
}) {
  if (isError) {
    return <Message title="Couldn't load the party">Try refreshing.</Message>;
  }
  if (isPending) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  return (
    <Message title={`No party with code ${code}`}>
      Double-check the code with your host.
    </Message>
  );
}

function Message({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 pt-24 text-center">
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
      <Button asChild variant="outline">
        <Link href="/game">Enter a different code</Link>
      </Button>
    </div>
  );
}
