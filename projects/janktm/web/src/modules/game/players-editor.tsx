'use client';

import { useMutation } from 'convex/react';
import { Trash2Icon } from 'lucide-react';
import { useState } from 'react';

import { Button, Input } from '@libs/ui-web';
import { api } from '@platform/convex-contracts';

import { errorMessage } from './format';
import type { PartyPlayer, Standing } from './types';

/** Players save individually and immediately, separate from the event form above. */
export function PlayersEditor({
  players,
  standings,
}: {
  players: PartyPlayer[];
  standings: Standing[];
}) {
  const eventsPlayed = new Map(
    standings.map((s) => [s.playerId, s.eventsPlayed]),
  );

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-xl font-semibold">Players</h2>
        <p className="text-sm text-muted-foreground">
          Renames and removals save right away.
        </p>
      </div>
      {players.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has joined yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-xs">
          {players.map((player) => (
            <PlayerRow
              key={player._id}
              player={player}
              eventsPlayed={eventsPlayed.get(player._id) ?? 0}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PlayerRow({
  player,
  eventsPlayed,
}: {
  player: PartyPlayer;
  eventsPlayed: number;
}) {
  const rename = useMutation(api.game.players.rename);
  const remove = useMutation(api.game.players.remove);
  const [name, setName] = useState(player.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = name.trim() !== player.name;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    const results =
      eventsPlayed > 0
        ? ` Their ${eventsPlayed} ${eventsPlayed === 1 ? 'result' : 'results'} will be deleted.`
        : '';
    if (window.confirm(`Remove ${player.name}?${results}`)) {
      void run(() => remove({ playerId: player._id }));
    }
  };

  return (
    <li className="space-y-1 px-3 py-2.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) void run(() => rename({ playerId: player._id, name }));
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Name for ${player.name}`}
          className="h-10 text-base"
        />
        {changed && (
          <Button type="submit" className="h-10" disabled={busy}>
            Save
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          aria-label={`Remove ${player.name}`}
          disabled={busy}
          onClick={confirmRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2Icon />
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}
