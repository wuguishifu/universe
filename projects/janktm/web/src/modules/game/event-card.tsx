'use client';

import { useMutation } from 'convex/react';
import { useState } from 'react';

import { cn } from '@libs/ui-web';
import { api } from '@platform/convex-contracts';

import {
  describeScoring,
  errorMessage,
  placeLabel,
  pointsLabel,
} from './format';
import type { PartyEvent, PartyPlayer } from './types';

export function EventCard({
  event,
  players,
  me,
}: {
  event: PartyEvent;
  players: PartyPlayer[];
  me: PartyPlayer | undefined;
}) {
  const setResult = useMutation(api.game.results.set);
  const [pendingPlace, setPendingPlace] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scoredPlaces = event.placePoints.length;
  const otherPlace = scoredPlaces + 1;
  const myResult = me && event.results.find((r) => r.playerId === me._id);
  const namesById = new Map(players.map((p) => [p._id, p.name]));

  const choose = async (place: number) => {
    if (!me) return;
    setError(null);
    setPendingPlace(place);
    try {
      await setResult({
        playerId: me._id,
        eventId: event._id,
        // Tapping your current place again clears it.
        place: myResult?.place === place ? null : place,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPendingPlace(null);
    }
  };

  const groups = groupResults(event.results, scoredPlaces);

  return (
    <article className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl font-semibold">{event.name}</h3>
          <p className="text-xs text-muted-foreground">
            {describeScoring(event)}
          </p>
        </div>
        {myResult && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary">
            +{pointsLabel(myResult.points)}
          </span>
        )}
      </header>

      {me && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase">
            Where did you place?
          </p>
          <div className="flex flex-wrap gap-2">
            {[...event.placePoints.keys()]
              .map((i) => i + 1)
              .concat(otherPlace)
              .map((place) => {
                const selected = myResult?.place === place;
                return (
                  <button
                    key={place}
                    type="button"
                    aria-pressed={selected}
                    disabled={pendingPlace !== null}
                    onClick={() => void choose(place)}
                    className={cn(
                      'h-10 min-w-14 rounded-lg border px-3 text-sm font-semibold transition-all active:translate-y-px disabled:opacity-60',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                        : 'bg-background hover:bg-muted',
                      pendingPlace === place && 'animate-pulse',
                    )}
                  >
                    {placeLabel(place, scoredPlaces)}
                  </button>
                );
              })}
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {groups.length > 0 ? (
        <ul className="divide-y rounded-lg border bg-background/60">
          {groups.map((group) => (
            <li
              key={group.label}
              className="flex items-baseline gap-3 px-3 py-2 text-sm"
            >
              <span className="w-12 shrink-0 font-bold">{group.label}</span>
              <span className="min-w-0 flex-1">
                {group.playerIds
                  .map((id) => namesById.get(id) ?? '?')
                  .join(', ')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {pointsLabel(group.points)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No results yet.</p>
      )}
    </article>
  );
}

/** Results arrive sorted by place; every place past the scored ones folds into "Other". */
function groupResults(results: PartyEvent['results'], scoredPlaces: number) {
  const groups: {
    label: string;
    points: number;
    playerIds: PartyEvent['results'][number]['playerId'][];
  }[] = [];
  for (const result of results) {
    const label = placeLabel(result.place, scoredPlaces);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.playerIds.push(result.playerId);
    else
      groups.push({
        label,
        points: result.points,
        playerIds: [result.playerId],
      });
  }
  return groups;
}
