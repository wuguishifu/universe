import Link from 'next/link';

import { buttonVariants } from '@libs/web-ui';

import { JoinCodeForm } from '../../modules/game/join-code-form';

export default function GamePage() {
  return (
    <div className="flex min-h-[70dvh] flex-col justify-center gap-10">
      <header className="text-center">
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">
          Game Night
        </h1>
        <p className="mt-2 text-muted-foreground">
          Enter your party code to join.
        </p>
      </header>

      <JoinCodeForm />

      <div className="text-center text-sm text-muted-foreground">
        Hosting?{' '}
        <Link
          href="/game/new"
          className={buttonVariants({ variant: 'link', className: 'px-1' })}
        >
          Create a party
        </Link>
      </div>
    </div>
  );
}
