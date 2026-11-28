'use client';

import { useMutation } from 'convex/react';
import { useState } from 'react';

import { Button, Input } from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

import { errorMessage } from './format';
import type { PartyPlayer } from './types';

export function JoinParty({
  code,
  players,
  onJoined,
}: {
  code: string;
  players: PartyPlayer[];
  onJoined: (playerId: string) => void;
}) {
  const join = useMutation(api.game.players.join);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { playerId } = await join({ code, name });
      onJoined(playerId);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <div>
        <h2 className="font-display text-xl font-semibold">Who are you?</h2>
        <p className="text-sm text-muted-foreground">
          Join to record your placements.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          autoComplete="given-name"
          className="h-11 text-base"
        />
        <Button
          type="submit"
          className="h-11 px-5"
          disabled={submitting || !name.trim()}
        >
          Join
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {players.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            Already joined? Tap your name
          </p>
          <div className="flex flex-wrap gap-2">
            {players.map((player) => (
              <Button
                key={player._id}
                type="button"
                variant="secondary"
                onClick={() => onJoined(player._id)}
              >
                {player.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
