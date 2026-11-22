import type { Doc, Id } from '../_generated/dataModel';

import type { PlaceScoring } from './validators';

export type ScoringConfig = Pick<
  Doc<'gameEvents'>,
  | 'placePoints'
  | 'minimumPoints'
  | 'roundMultipliers'
  | 'roundMode'
  | 'roundScoring'
>;

export type RoundMode = NonNullable<Doc<'gameEvents'>['roundMode']>;

export type ScoredResult = {
  playerId: Id<'gamePlayers'>;
  place: number;
  round: number;
  /** What this round placement earned: party points in 'perRound' mode, round points in 'standings'. */
  points: number;
};

export type EventStanding = {
  playerId: Id<'gamePlayers'>;
  /** Sum of the player's round points. */
  total: number;
  rank: number;
  /** Party points earned for finishing at `rank`. */
  points: number;
};

/** Fractional multipliers (1.5x) shouldn't leave float noise like 7.499999. */
export function roundPoints(points: number): number {
  return Math.round(points * 100) / 100;
}

export function roundMultipliers(event: ScoringConfig): number[] {
  return event.roundMultipliers?.length ? event.roundMultipliers : [1];
}

export function roundMode(event: ScoringConfig): RoundMode {
  return event.roundMode ?? 'perRound';
}

/** What a placement within a round earns, before that round's multiplier. */
export function roundPlaceScoring(event: ScoringConfig): PlaceScoring {
  return (roundMode(event) === 'standings' && event.roundScoring) || event;
}

export function resultRound(result: Pick<Doc<'gameResults'>, 'round'>): number {
  return result.round ?? 0;
}

function pointsAt(scoring: PlaceScoring, place: number): number {
  return scoring.placePoints[place - 1] ?? scoring.minimumPoints;
}

/** What placing `place` in `round` earns (see `ScoredResult.points`). */
export function pointsForPlace(
  event: ScoringConfig,
  place: number,
  round: number,
): number {
  const multiplier = roundMultipliers(event)[round] ?? 1;
  return roundPoints(pointsAt(roundPlaceScoring(event), place) * multiplier);
}

/** Standard competition ranking: totals of 10, 10, 7 rank 1, 1, 3. Expects `sorted` desc by total. */
export function withRanks<T extends { total: number }>(
  sorted: T[],
): (T & { rank: number })[] {
  let rank = 0;
  let previous: number | undefined;
  return sorted.map((entry, i) => {
    if (entry.total !== previous) rank = i + 1;
    previous = entry.total;
    return { ...entry, rank };
  });
}

/**
 * Scores one event's results. `partyPoints` is what each player who took part earns toward the
 * party total. `standings` (sorted by rank) is only set in 'standings' mode.
 */
export function scoreEvent(
  event: ScoringConfig,
  results: Pick<Doc<'gameResults'>, 'playerId' | 'place' | 'round'>[],
): {
  results: ScoredResult[];
  standings: EventStanding[] | null;
  partyPoints: Map<Id<'gamePlayers'>, number>;
} {
  const scored = results.map((result) => {
    const round = resultRound(result);
    return {
      playerId: result.playerId,
      place: result.place,
      round,
      points: pointsForPlace(event, result.place, round),
    };
  });

  const sums = new Map<Id<'gamePlayers'>, number>();
  for (const { playerId, points } of scored) {
    sums.set(playerId, roundPoints((sums.get(playerId) ?? 0) + points));
  }

  if (roundMode(event) !== 'standings') {
    return { results: scored, standings: null, partyPoints: sums };
  }

  const sorted = [...sums]
    .map(([playerId, total]) => ({ playerId, total }))
    .sort((a, b) => b.total - a.total);
  const standings = withRanks(sorted).map((entry) => ({
    ...entry,
    points: pointsAt(event, entry.rank),
  }));
  return {
    results: scored,
    standings,
    partyPoints: new Map(standings.map((s) => [s.playerId, s.points])),
  };
}
