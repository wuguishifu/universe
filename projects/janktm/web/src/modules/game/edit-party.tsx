'use client';

import { useMutation } from 'convex/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { api } from '@platform/convex-contracts';

import { useQuery } from '../convex/use-query';

import { draftFromEvent, PartyForm } from './party-form';
import { PartyStatus } from './party-status';
import { PlayersEditor } from './players-editor';

export function EditParty({ code }: { code: string }) {
  const router = useRouter();
  const {
    data: party,
    isPending,
    isError,
  } = useQuery(api.game.parties.get, {
    code,
  });
  const updateParty = useMutation(api.game.parties.update);

  if (isError || isPending || !party) {
    return <PartyStatus code={code} isError={isError} isPending={isPending} />;
  }

  const partyUrl = `/game/${party.party.code}`;

  return (
    <div className="space-y-8">
      <header>
        <Link
          href={partyUrl}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to {party.party.name}
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Edit party
        </h1>
      </header>

      {/* Keyed by party so the form's local draft starts from the saved state. */}
      <PartyForm
        key={party.party._id}
        initialName={party.party.name}
        initialEvents={party.events.map(draftFromEvent)}
        submitLabel="Save changes"
        submittingLabel="Saving…"
        onSubmit={async (values) => {
          await updateParty({ partyId: party.party._id, ...values });
          router.push(partyUrl);
        }}
      />

      <PlayersEditor players={party.players} standings={party.standings} />
    </div>
  );
}
