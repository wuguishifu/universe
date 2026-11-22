import type { Doc } from '../_generated/dataModel';

export type ScoringConfig = Pick<
  Doc<'gameEvents'>,
  'placePoints' | 'minimumPoints' | 'roundMultipliers'
>;

export function roundMultipliers(event: ScoringConfig): number[] {
  return event.roundMultipliers?.length ? event.roundMultipliers : [1];
}

export function resultRound(result: Pick<Doc<'gameResults'>, 'round'>): number {
  return result.round ?? 0;
}

export function pointsForPlace(
  event: ScoringConfig,
  place: number,
  round: number,
): number {
  const base = event.placePoints[place - 1] ?? event.minimumPoints;
  const multiplier = roundMultipliers(event)[round] ?? 1;
  // Fractional multipliers (1.5x) shouldn't leave float noise like 7.499999.
  return Math.round(base * multiplier * 100) / 100;
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
