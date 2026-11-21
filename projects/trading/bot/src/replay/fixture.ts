import { z } from 'zod';

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import { Bar, EngineEvent } from '@projects/trading-core';

const barRowSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
export const quoteRowSchema = z.tuple([z.number(), z.number(), z.number()]);
/** The backtest wrote these; only the shape the comparison reads is checked. */
export const engineEventSchema = z.custom<EngineEvent>(
  (value) => typeof value === 'object' && value !== null && 'type' in value,
);

/** `[time, open, high, low, close, volume]` */
export type BarRow = z.infer<typeof barRowSchema>;
/** `[time, bid, ask]`, only when the quote changed (as in the backtest's quote files). */
export type QuoteRow = z.infer<typeof quoteRowSchema>;

/**
 * Recorded market data for a few trading days, and what `backtest run` decided on them. Built by
 * `build-fixture.ts` from the backtester's data directory, trimmed to what the replay touches.
 */
export const replayFixtureSchema = z.object({
  description: z.string(),
  generatedAt: z.string(),
  /** The backtest config the expectations came from, relative to projects/trading/backtest. */
  config: z.string(),
  windows: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      /** The backtest's events for the window, without per-bar snapshots. */
      expected: z.array(engineEventSchema),
    }),
  ),
  calendar: z.array(
    z.object({ date: z.string(), open: z.string(), close: z.string() }),
  ),
  ticker: z.string(),
  /** 1-minute bars by New York date. */
  bars: z.record(z.string(), z.array(barRowSchema)),
  /** Option quotes by New York date, then OCC symbol. */
  quotes: z.record(z.string(), z.record(z.string(), z.array(quoteRowSchema))),
});
export type ReplayFixture = z.infer<typeof replayFixtureSchema>;

export const toBar = ([time, open, high, low, close, volume]: BarRow): Bar => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

export const fromBar = (bar: Bar): BarRow => [
  bar.time,
  bar.open,
  bar.high,
  bar.low,
  bar.close,
  bar.volume,
];

export function loadFixture(path: string): ReplayFixture {
  return replayFixtureSchema.parse(
    JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')),
  );
}

/** The quote standing at `time`: the last change at or before it. */
export function quoteAt(
  rows: readonly QuoteRow[],
  time: number,
): QuoteRow | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let found: QuoteRow | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = rows[mid];
    if (!row) break;
    if (row[0] <= time) {
      found = row;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
