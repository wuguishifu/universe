import Link from 'next/link';

import { CreatePartyForm } from '../../../modules/game/create-party-form';

export default function NewPartyPage() {
  return (
    <div className="space-y-6">
      <header>
        <Link
          href="/game"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          New party
        </h1>
        <p className="mt-1 text-muted-foreground">
          Set up the events and how many points each place is worth.
        </p>
      </header>
      <CreatePartyForm />
    </div>
  );
}
