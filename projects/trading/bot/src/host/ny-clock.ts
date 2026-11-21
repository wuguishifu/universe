import { nyTime, parseClockTime } from '@projects/trading-core';

const DAY_MS = 86_400_000;

/** Epoch ms of a New York wall-clock minute (`570` is 09:30) on a `YYYY-MM-DD` date. */
export function nyEpoch(date: string, minute: number): number {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  // New York is UTC-4 or UTC-5; exactly one of them gives back the same wall-clock time.
  for (const offsetHours of [4, 5]) {
    const time = midnightUtc + (minute + offsetHours * 60) * 60_000;
    const back = nyTime(time);
    if (back.date === date && Math.abs(back.minute - minute) < 1e-6)
      return time;
  }
  throw new Error(`No New York time ${minute} on ${date}`);
}

/** `nyEpoch` from an `HH:MM` string. */
export const nyEpochAt = (date: string, hhmm: string): number =>
  nyEpoch(date, parseClockTime(hhmm));

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
