'use client';

import { useMutation } from 'convex/react';
import { useRouter } from 'next/navigation';

import { api } from '@platform/convex-contracts';

import { PartyForm } from './party-form';

export function CreatePartyForm() {
  const router = useRouter();
  const createParty = useMutation(api.game.parties.create);

  return (
    <PartyForm
      submitLabel="Create party"
      submittingLabel="Creating…"
      onSubmit={async (values) => {
        const { code } = await createParty(values);
        router.push(`/game/${code}?created=1`);
      }}
    />
  );
}
