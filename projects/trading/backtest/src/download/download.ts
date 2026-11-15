import { z } from 'zod';

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { CalendarDay, daysBetween, OptionType } from '@projects/trading-core';

import { alpacaCalendarDaySchema, occSymbol } from '../data/alpaca';
import { DataStore } from '../data/data-store';

import { AlpacaClient, DailyAdjustment } from './alpaca-client';

export type DownloadOptions = {
  client: AlpacaClient;
  dir: string;
  tickers: readonly string[];
  /** First and last trading day, `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  /** Option expirations from 0 up to this many calendar days out. */
  expiryDays: number;
  /** Strikes from this far below the day's low to this far above its high. */
  strikePadding: number;
  strikeStep: number;
  /** Trading days of stock bars to fetch before `from`, for indicator warmup. */
  warmupDays: number;
  /** Skip option bars, e.g. for years before Alpaca's option history starts (February 2024). */
  stocksOnly?: boolean;
  log: (line: string) => void;
};

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** 04:00–20:00 New York, in either standard or daylight time. */
const dayWindow = (date: string) => ({
  start: `${date}T08:00:00Z`,
  end: `${addDays(date, 1)}T01:00:00Z`,
});

/** Writes to a temp file and renames, so an interrupted download never leaves a half-written day. */
function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

/** Every OCC symbol to fetch for one underlying on one day. */
export function optionSymbolsFor(
  underlying: string,
  date: string,
  range: { low: number; high: number },
  calendarDates: readonly string[],
  options: Pick<DownloadOptions, 'expiryDays' | 'strikePadding' | 'strikeStep'>,
): string[] {
  const { expiryDays, strikePadding, strikeStep } = options;
  const expirations = calendarDates.filter((d) => {
    const dte = daysBetween(date, d);
    return dte >= 0 && dte <= expiryDays;
  });
  const lowest = Math.floor((range.low - strikePadding) / strikeStep);
  const highest = Math.ceil((range.high + strikePadding) / strikeStep);

  const symbols: string[] = [];
  for (const expiration of expirations) {
    for (let step = lowest; step <= highest; step++) {
      const strike = Math.round(step * strikeStep * 1000) / 1000;
      for (const type of ['call', 'put'] satisfies OptionType[]) {
        symbols.push(occSymbol({ underlying, expiration, type, strike }));
      }
    }
  }
  return symbols;
}

/** Fills `dir` with the layout `DataStore` reads. Days already on disk are skipped, so it can resume. */
export async function download(options: DownloadOptions): Promise<void> {
  const { client, dir, tickers, from, to, log } = options;

  // Reach far enough back for warmup and far enough forward for every expiry we might fetch.
  const fetched = await client.calendar(
    addDays(from, -30),
    addDays(to, options.expiryDays + 7),
  );
  const calendarPath = DataStore.calendarPath(dir);
  const existing: CalendarDay[] = existsSync(calendarPath)
    ? z
        .array(alpacaCalendarDaySchema)
        .parse(JSON.parse(readFileSync(calendarPath, 'utf8')))
    : [];
  const byDate = new Map(
    [...existing, ...fetched].map((day) => [day.date, day]),
  );
  const calendar = [...byDate.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  writeJsonAtomic(calendarPath, calendar);
  log(`calendar: ${calendar.length} trading days on file`);

  const dates = calendar.map((day) => day.date);
  const days = dates.filter((date) => date >= from && date <= to);
  const firstIndex = days[0] ? dates.indexOf(days[0]) : 0;
  const warmup = dates.slice(
    Math.max(0, firstIndex - options.warmupDays),
    firstIndex,
  );

  for (const date of [...warmup, ...days]) {
    for (const ticker of tickers) {
      const path = DataStore.stockPath(dir, ticker, date);
      if (existsSync(path)) continue;
      const { start, end } = dayWindow(date);
      const bars = await client.stockBars(ticker, start, end);
      writeJsonAtomic(path, bars);
      log(`${date} ${ticker}: ${bars.length} stock bars`);
    }
  }

  if (options.stocksOnly) return;

  const store = new DataStore(dir);
  for (const date of days) {
    for (const ticker of tickers) {
      const path = DataStore.optionPath(dir, ticker, date);
      if (existsSync(path)) continue;
      const stock = store.stockBars(ticker, date) ?? [];
      if (stock.length === 0) {
        log(`${date} ${ticker}: no stock bars, skipping options`);
        continue;
      }
      const range = {
        low: Math.min(...stock.map((b) => b.low)),
        high: Math.max(...stock.map((b) => b.high)),
      };
      const symbols = optionSymbolsFor(ticker, date, range, dates, options);
      const { start, end } = dayWindow(date);
      const bars: Record<string, unknown[]> = {};
      for (let i = 0; i < symbols.length; i += 100) {
        Object.assign(
          bars,
          await client.optionBars(symbols.slice(i, i + 100), start, end),
        );
      }
      writeJsonAtomic(path, bars);
      log(
        `${date} ${ticker}: ${Object.keys(bars).length} of ${symbols.length} contracts traded`,
      );
    }
  }
}

export type DailyDownloadOptions = Pick<
  DownloadOptions,
  'client' | 'dir' | 'tickers' | 'from' | 'to' | 'log'
> & {
  adjustment: DailyAdjustment;
  /** Leave tickers already on disk alone, to resume a long download. */
  skipExisting: boolean;
};

const DAILY_BATCH = 100;

/**
 * Fetches daily bars, 100 tickers per request, replacing what's on disk unless `skipExisting`.
 * Adjusted prices change whenever a ticker pays a dividend, so a partial update would mix two
 * adjustments. Tickers Alpaca has no bars for are written as empty files, so a resume skips them.
 */
export async function downloadDaily(
  options: DailyDownloadOptions,
): Promise<void> {
  const { client, dir, from, to, adjustment, log } = options;
  const tickers = options.skipExisting
    ? options.tickers.filter(
        (t) => !existsSync(DataStore.dailyPath(dir, t, adjustment)),
      )
    : options.tickers;
  log(`${tickers.length} tickers to fetch (${adjustment})`);

  for (let i = 0; i < tickers.length; i += DAILY_BATCH) {
    const batch = tickers.slice(i, i + DAILY_BATCH);
    const bars = await client.dailyBars(
      batch,
      `${from}T00:00:00Z`,
      `${addDays(to, 1)}T00:00:00Z`,
      adjustment,
    );
    let found = 0;
    for (const ticker of batch) {
      const list = bars[ticker] ?? [];
      if (list.length > 0) found++;
      writeJsonAtomic(DataStore.dailyPath(dir, ticker, adjustment), list);
    }
    log(
      `${Math.min(i + DAILY_BATCH, tickers.length)}/${tickers.length}: ${found} of ${batch.length} had bars`,
    );
  }
}
