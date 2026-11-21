'use client';

import { CheckIcon, CopyIcon, PencilIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@libs/ui-web';
import { api } from '@platform/convex-contracts';

import { useQuery } from '../convex/use-query';

import { EventCard } from './event-card';
import { ordinal, pointsLabel } from './format';
import { JoinParty } from './join-party';
import { PartyStatus } from './party-status';
import { Standings } from './standings';
import type { Party, PartyPlayer } from './types';
import { usePlayerId } from './use-player-id';

type Tab = 'events' | 'standings';

export function PartyView({
  code,
  justCreated,
}: {
  code: string;
  justCreated: boolean;
}) {
  const {
    data: party,
    isPending,
    isError,
  } = useQuery(api.game.parties.get, {
    code,
  });
  const [playerId, setPlayerId] = usePlayerId(code);
  const [tab, setTab] = useState<Tab>('events');

  if (isError || isPending || playerId === undefined || !party) {
    return (
      <PartyStatus
        code={code}
        isError={isError}
        isPending={isPending || playerId === undefined}
      />
    );
  }

  const me = party.players.find((player) => player._id === playerId);

  return (
    <div className="space-y-5">
      <PartyHeader party={party} />

      {justCreated && !me && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
          <p className="font-semibold">Your party is ready!</p>
          <p className="mt-1 text-muted-foreground">
            Have guests go to this site and enter{' '}
            <span className="font-mono font-bold text-foreground">
              {party.party.code}
            </span>
            . Join below if you&apos;re playing too.
          </p>
        </div>
      )}

      {me ? (
        <YourScore party={party} me={me} onSwitch={() => setPlayerId(null)} />
      ) : (
        <JoinParty
          code={party.party.code}
          players={party.players}
          onJoined={setPlayerId}
        />
      )}

      <div
        role="tablist"
        className="sticky top-2 z-10 grid grid-cols-2 gap-1 rounded-xl border bg-card/90 p-1 shadow-xs backdrop-blur"
      >
        <TabButton active={tab === 'events'} onClick={() => setTab('events')}>
          Events
        </TabButton>
        <TabButton
          active={tab === 'standings'}
          onClick={() => setTab('standings')}
        >
          Standings
        </TabButton>
      </div>

      {tab === 'events' ? (
        <div className="space-y-3">
          {party.events.map((event) => (
            <EventCard
              key={event._id}
              event={event}
              players={party.players}
              me={me}
            />
          ))}
        </div>
      ) : (
        <Standings standings={party.standings} meId={me?._id} />
      )}
    </div>
  );
}

function PartyHeader({ party }: { party: Party }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(party.party.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (e.g. plain http on a LAN IP); the code is on screen anyway.
    }
  };

  return (
    <header className="space-y-1">
      <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
        <Link href="/game" className="hover:text-foreground">
          ← Game Night
        </Link>
        <Link
          href={`/game/${party.party.code}/edit`}
          className="flex items-center gap-1.5 font-medium hover:text-foreground"
        >
          <PencilIcon className="size-3.5" /> Edit party
        </Link>
      </div>
      <div className="flex items-start justify-between gap-4">
        <h1 className="font-display text-3xl leading-tight text-balance break-words font-semibold tracking-tight">
          {party.party.name}
        </h1>
        <button
          type="button"
          onClick={() => void copy()}
          className="mt-0.5 flex shrink-0 items-center gap-2 rounded-lg border bg-card px-3 py-2 font-mono text-lg font-bold tracking-widest shadow-xs active:translate-y-px"
          aria-label={`Party code ${party.party.code}, copy`}
        >
          {party.party.code}
          {copied ? (
            <CheckIcon className="size-4 text-primary" />
          ) : (
            <CopyIcon className="size-4 text-muted-foreground" />
          )}
        </button>
      </div>
    </header>
  );
}

function YourScore({
  party,
  me,
  onSwitch,
}: {
  party: Party;
  me: PartyPlayer;
  onSwitch: () => void;
}) {
  const standing = party.standings.find((s) => s.playerId === me._id);
  const total = standing?.total ?? 0;
  const tied =
    standing !== undefined &&
    party.standings.filter((s) => s.rank === standing.rank).length > 1;

  return (
    <section className="flex items-center justify-between gap-4 rounded-xl bg-accent p-4 text-accent-foreground shadow-sm">
      <div className="min-w-0">
        <p className="text-sm opacity-80">
          Playing as <span className="font-semibold">{me.name}</span>
          {' · '}
          <button
            type="button"
            onClick={onSwitch}
            className="underline underline-offset-2"
          >
            switch
          </button>
        </p>
        <p className="mt-1 font-display text-3xl font-semibold">
          {pointsLabel(total)}
        </p>
      </div>
      {standing && (
        <div className="text-right">
          <p className="font-display text-3xl font-semibold">
            {tied && <span className="text-lg opacity-80">T-</span>}
            {ordinal(standing.rank)}
          </p>
          <p className="text-sm opacity-80">of {party.standings.length}</p>
        </div>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'h-9 rounded-lg text-sm font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-xs'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
