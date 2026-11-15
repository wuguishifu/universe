import { z } from 'zod';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Bar, CalendarDay, nyTime } from '@projects/trading-core';

import { DailyAdjustment } from '../download/alpaca-client';

import { alpacaBarSchema, alpacaCalendarDaySchema, toBar } from './alpaca';
import { QuoteFile } from './theta';

/**
 * Reads historical data laid out as:
 *
 * ```
 * calendar.json                  Alpaca /v2/calendar response
 * stocks/<TICKER>/<DATE>.json    [AlpacaBar, ...]                 1-minute bars for that New York date
 * options/<TICKER>/<DATE>.json   { "<OCC symbol>": [AlpacaBar] }  1-minute bars for that date
 * quotes/<TICKER>/<DATE>.json    { "<OCC symbol>": [QuoteRow] }   bid/ask changes that date, from Theta Data
 * daily/<TICKER>.json            [AlpacaBar, ...]                 daily bars, split- and dividend-adjusted
 * daily-raw/<TICKER>.json        [AlpacaBar, ...]                 daily bars as traded, unadjusted
 * ```
 */
export class DataStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  static calendarPath = (dir: string) => join(dir, 'calendar.json');
  static stockPath = (dir: string, ticker: string, date: string) =>
    join(dir, 'stocks', ticker, `${date}.json`);
  static optionPath = (dir: string, ticker: string, date: string) =>
    join(dir, 'options', ticker, `${date}.json`);
  static quotePath = (dir: string, ticker: string, date: string) =>
    join(dir, 'quotes', ticker, `${date}.json`);
  static dailyPath = (
    dir: string,
    ticker: string,
    adjustment: DailyAdjustment = 'all',
  ) =>
    join(dir, adjustment === 'all' ? 'daily' : 'daily-raw', `${ticker}.json`);

  calendar(): CalendarDay[] {
    const path = DataStore.calendarPath(this.dir);
    if (!existsSync(path)) {
      throw new Error(
        `No calendar at ${path}. Download /v2/calendar there first.`,
      );
    }
    return z
      .array(alpacaCalendarDaySchema)
      .parse(readJson(path))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** 1-minute bars sorted by time, or null if that day wasn't downloaded. */
  stockBars(ticker: string, date: string): Bar[] | null {
    const path = DataStore.stockPath(this.dir, ticker, date);
    if (!existsSync(path)) return null;
    return z
      .array(alpacaBarSchema)
      .parse(readJson(path))
      .map(toBar)
      .sort(byTime);
  }

  /** 1-minute bars for each option symbol, sorted by time, or null if that day wasn't downloaded. */
  optionBars(ticker: string, date: string): Map<string, Bar[]> | null {
    const path = DataStore.optionPath(this.dir, ticker, date);
    if (!existsSync(path)) return null;
    const raw = z
      .record(z.string(), z.array(alpacaBarSchema))
      .parse(readJson(path));
    return new Map(
      Object.entries(raw).map(([symbol, bars]) => [
        symbol,
        bars.map(toBar).sort(byTime),
      ]),
    );
  }

  /** Each option symbol's bid/ask changes, sorted by time, or null if that day wasn't downloaded. */
  optionQuotes(ticker: string, date: string): QuoteFile | null {
    const path = DataStore.quotePath(this.dir, ticker, date);
    if (!existsSync(path)) return null;
    return quoteFileSchema.parse(readJson(path));
  }

  /** Adjusted daily bars sorted by date, or null if the ticker wasn't downloaded. */
  dailyBars(
    ticker: string,
    adjustment: DailyAdjustment = 'all',
  ): DailyBar[] | null {
    const path = DataStore.dailyPath(this.dir, ticker, adjustment);
    if (!existsSync(path)) return null;
    return z
      .array(alpacaBarSchema)
      .parse(readJson(path))
      .map((bar) => ({ date: nyTime(Date.parse(bar.t)).date, ...toBar(bar) }))
      .sort(byTime);
  }
}

const quoteFileSchema = z.record(
  z.string(),
  z.array(z.tuple([z.number(), z.number(), z.number()])),
);

/** A daily bar, labelled with its New York date. */
export type DailyBar = Bar & { date: string };

const byTime = (a: Bar, b: Bar) => a.time - b.time;

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));

/** The reads a backtest needs. */
export type MarketData = Pick<
  DataStore,
  'calendar' | 'stockBars' | 'optionBars'
>;

/**
 * Keeps everything it reads in memory. Parsing JSON is most of a single run's time, so a sweep
 * running many configs over the same days reads each file once.
 */
export class CachedDataStore extends DataStore {
  private calendarCache: CalendarDay[] | undefined;
  private readonly stocks = new Map<string, Bar[] | null>();
  private readonly options = new Map<string, Map<string, Bar[]> | null>();

  override calendar(): CalendarDay[] {
    return (this.calendarCache ??= super.calendar());
  }

  override stockBars(ticker: string, date: string): Bar[] | null {
    const key = `${ticker}/${date}`;
    if (!this.stocks.has(key))
      this.stocks.set(key, super.stockBars(ticker, date));
    return this.stocks.get(key) ?? null;
  }

  override optionBars(ticker: string, date: string): Map<string, Bar[]> | null {
    const key = `${ticker}/${date}`;
    if (!this.options.has(key))
      this.options.set(key, super.optionBars(ticker, date));
    return this.options.get(key) ?? null;
  }
}
