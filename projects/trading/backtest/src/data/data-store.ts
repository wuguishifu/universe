import { z } from 'zod';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Bar, CalendarDay } from '@projects/trading-core';

import { alpacaBarSchema, alpacaCalendarDaySchema, toBar } from './alpaca';

/**
 * Reads historical data laid out as:
 *
 * ```
 * calendar.json                  Alpaca /v2/calendar response
 * stocks/<TICKER>/<DATE>.json    [AlpacaBar, ...]                 1-minute bars for that New York date
 * options/<TICKER>/<DATE>.json   { "<OCC symbol>": [AlpacaBar] }  1-minute bars for that date
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
}

const byTime = (a: Bar, b: Bar) => a.time - b.time;

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));
