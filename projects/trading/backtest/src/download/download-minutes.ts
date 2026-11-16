import { z } from 'zod';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { DataStore } from '../data/data-store';

import { AlpacaClient } from './alpaca-client';
import { addDays } from './download';

/**
 * Which part of the day to fetch. `day` is 04:00–20:00 and goes to `stocks/` like the regular
 * download; `open15` is 09:30–09:45 of the regular session and goes to `stocks-open15/`.
 */
export type MinuteWindow = 'day' | 'open15';

const jobsSchema = z.object({
  window: z.enum(['day', 'open15']),
  /** Date → symbols to fetch that day. */
  days: z.record(z.string(), z.array(z.string())),
});
export type MinuteJobs = z.infer<typeof jobsSchema>;

export const loadMinuteJobs = (path: string): MinuteJobs =>
  jobsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

export function minutePath(
  dir: string,
  window: MinuteWindow,
  ticker: string,
  date: string,
): string {
  return window === 'day'
    ? DataStore.stockPath(dir, ticker, date)
    : join(dir, 'stocks-open15', ticker, `${date}.json`);
}

/** UTC bounds of a window on a New York date. 09:30 NY is 13:30 or 14:30 UTC, so both are covered and trimmed. */
function windowBounds(
  date: string,
  window: MinuteWindow,
): { start: string; end: string; keep: (t: string) => boolean } {
  if (window === 'day')
    return {
      start: `${date}T08:00:00Z`,
      end: `${addDays(date, 1)}T01:00:00Z`,
      keep: () => true,
    };
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return {
    start: `${date}T13:30:00Z`,
    end: `${date}T14:45:00Z`,
    keep: (t) => {
      const [h = 0, m = 0] = fmt.format(Date.parse(t)).split(':').map(Number);
      const minute = h * 60 + m;
      return minute >= 570 && minute < 585;
    },
  };
}

/**
 * Downloads 1-minute bars for the (date, symbols) pairs in `jobs`, 100 symbols per request. Pairs
 * already on disk are skipped, and a symbol with no bars that day is written as an empty file, so a
 * rerun resumes.
 */
export async function downloadMinutes(options: {
  client: AlpacaClient;
  dir: string;
  jobs: MinuteJobs;
  log: (line: string) => void;
}): Promise<void> {
  const { client, dir, jobs, log } = options;
  const window = jobs.window;
  const dates = Object.keys(jobs.days).sort();
  let fetched = 0;
  let skipped = 0;
  for (const [i, date] of dates.entries()) {
    const symbols = [...new Set(jobs.days[date] ?? [])].filter((s) => {
      const have = existsSync(minutePath(dir, window, s, date));
      if (have) skipped += 1;
      return !have;
    });
    const { start, end, keep } = windowBounds(date, window);
    for (let k = 0; k < symbols.length; k += 100) {
      const batch = symbols.slice(k, k + 100);
      const bars = await client.stockBarsMany(batch, start, end);
      for (const symbol of batch) {
        const path = minutePath(dir, window, symbol, date);
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        writeFileSync(
          tmp,
          JSON.stringify((bars[symbol] ?? []).filter((b) => keep(b.t))),
        );
        renameSync(tmp, path);
        fetched += 1;
      }
    }
    if ((i + 1) % 50 === 0 || i === dates.length - 1)
      log(
        `${date}: ${i + 1}/${dates.length} days, ${fetched} symbol-days fetched, ${skipped} already on disk`,
      );
  }
}
