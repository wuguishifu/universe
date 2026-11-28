'use client';

import { useMutation } from 'convex/react';
import { useState } from 'react';

import { cn } from '@libs/web-ui';
import { api } from '@platform/convex-contracts';

import {
  describeScoring,
  errorMessage,
  multiplierLabel,
  ordinal,
  placeLabel,
  pointsLabel,
} from './format';
import type { PartyEvent, PartyPlayer } from './types';

type EventResult = PartyEvent['results'][number];
type EventStanding = NonNullable<PartyEvent['standings']>[number];

export function EventCard({
  event,
  players,
  me,
}: {
  event: PartyEvent;
  players: PartyPlayer[];
  me: PartyPlayer | undefined;
}) {
  const namesById = new Map(players.map((p) => [p._id, p.name]));
  const rounds = event.roundMultipliers;
  const multiRound = rounds.length > 1;
  const myResults = me
    ? event.results.filter((r) => r.playerId === me._id)
    : [];
  // In 'standings' mode round points only decide the order; the event's points are what count.
  const myStanding = me && event.standings?.find((s) => s.playerId === me._id);
  const myPoints = event.standings
    ? (myStanding?.points ?? 0)
    : Math.round(myResults.reduce((sum, r) => sum + r.points, 0) * 100) / 100;

  return (
    <article className="space-y-4 rounded-xl border bg-card p-4 shadow-xs">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-xl font-semibold">{event.name}</h3>
          {event.roundScoring ? (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold">Final standings:</span>{' '}
                {describeScoring(event)}
              </p>
              <p>
                <span className="font-semibold">
                  {multiRound ? `${rounds.length} rounds, each:` : 'Round:'}
                </span>{' '}
                {describeScoring(event.roundScoring)}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {multiRound && `${rounds.length} rounds · `}
              {describeScoring(event)}
            </p>
          )}
        </div>
        {myResults.length > 0 && (
          <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-bold text-primary">
            +{pointsLabel(myPoints)}
          </span>
        )}
      </header>

      {rounds.map((multiplier, round) => (
        <RoundSection
          key={round}
          event={event}
          round={round}
          multiplier={multiplier}
          showHeader={multiRound}
          me={me}
          namesById={namesById}
          results={event.results.filter((r) => r.round === round)}
        />
      ))}

      {event.standings && (
        <EventStandings
          standings={event.standings}
          me={me}
          namesById={namesById}
        />
      )}
    </article>
  );
}

function RoundSection({
  event,
  round,
  multiplier,
  showHeader,
  me,
  namesById,
  results,
}: {
  event: PartyEvent;
  round: number;
  multiplier: number;
  showHeader: boolean;
  me: PartyPlayer | undefined;
  namesById: Map<PartyPlayer['_id'], string>;
  results: EventResult[];
}) {
  const setResult = useMutation(api.game.results.set);
  const [pendingPlace, setPendingPlace] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scoring = event.roundScoring ?? event;
  const scoredPlaces = scoring.placePoints.length;
  const places = [...scoring.placePoints.keys()]
    .map((i) => i + 1)
    .concat(scoredPlaces + 1);
  const myResult = me && results.find((r) => r.playerId === me._id);

  const choose = async (place: number) => {
    if (!me) return;
    setError(null);
    setPendingPlace(place);
    try {
      await setResult({
        playerId: me._id,
        eventId: event._id,
        round,
        // Tapping your current place again clears it.
        place: myResult?.place === place ? null : place,
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPendingPlace(null);
    }
  };

  const groups = groupResults(results, scoredPlaces);

  return (
    <section
      className={cn(
        'space-y-3',
        showHeader && 'border-t pt-4 first-of-type:border-t-0',
      )}
    >
      {showHeader && (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h4 className="font-semibold">Round {round + 1}</h4>
          {multiplier !== 1 && (
            <>
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">
                {multiplierLabel(multiplier)} points
              </span>
              <span className="text-xs text-muted-foreground">
                {describeScoring(scoring, multiplier)}
              </span>
            </>
          )}
        </div>
      )}

      {me && (
        <div className="space-y-2">
          {!showHeader && (
            <p className="text-xs font-semibold text-muted-foreground uppercase">
              Where did you place?
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {places.map((place) => {
              const selected = myResult?.place === place;
              return (
                <button
                  key={place}
                  type="button"
                  aria-pressed={selected}
                  aria-label={
                    showHeader
                      ? `Round ${round + 1}: ${placeLabel(place, scoredPlaces)}`
                      : undefined
                  }
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
    </section>
  );
}

/** Where everyone stands on round points, and the event points that earns them. */
function EventStandings({
  standings,
  me,
  namesById,
}: {
  standings: EventStanding[];
  me: PartyPlayer | undefined;
  namesById: Map<PartyPlayer['_id'], string>;
}) {
  return (
    <section className="space-y-2 border-t pt-4">
      <h4 className="font-semibold">Event standings</h4>
      {standings.length > 0 ? (
        <ol className="divide-y rounded-lg border bg-background/60">
          {standings.map((standing) => (
            <li
              key={standing.playerId}
              className={cn(
                'flex items-baseline gap-3 px-3 py-2 text-sm',
                standing.playerId === me?._id && 'bg-primary/10',
              )}
            >
              <span className="w-12 shrink-0 font-bold">
                {ordinal(standing.rank)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {namesById.get(standing.playerId) ?? '?'}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {pointsLabel(standing.total)} in rounds
              </span>
              <span className="w-16 shrink-0 text-right font-semibold tabular-nums">
                +{pointsLabel(standing.points)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Standings appear once someone records a round.
        </p>
      )}
    </section>
  );
}

/** Results arrive sorted by place; every place past the scored ones folds into "Other". */
function groupResults(results: EventResult[], scoredPlaces: number) {
  const groups: {
    label: string;
    points: number;
    playerIds: EventResult['playerId'][];
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
