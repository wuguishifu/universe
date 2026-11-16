import { z } from 'zod';

import { nyTime, parseClockTime } from '../market/ny-time';
import { Bar } from '../market/types';

import { Indicator, priceOf, priceSourceSchema } from './indicator';

/** Minutes between the session's first bar and this one, so days line up bar for bar. */
const offsetIn = (bar: Bar, firstStart: number): number =>
  Math.round(nyTime(bar.time).minute - firstStart);

// --- price -------------------------------------------------------------------------------------

export const priceConfigSchema = z.object({
  type: z.literal('price'),
  source: priceSourceSchema.default('close'),
});
export type PriceConfig = z.infer<typeof priceConfigSchema>;

/** The bar's own price, so rules that compare indicators can compare against price too. */
export class Price implements Indicator {
  private readonly config: PriceConfig;
  private current: number | undefined;

  constructor(config: PriceConfig) {
    this.config = config;
  }

  get value(): number | undefined {
    return this.current;
  }

  update(bar: Bar): number | undefined {
    this.current = priceOf(bar, this.config.source);
    return this.current;
  }

  startSession(): void {
    // A price has no history to reset.
  }
}

// --- openingRange ------------------------------------------------------------------------------

export const openingRangeConfigSchema = z.object({
  type: z.literal('openingRange'),
  /** Which edge of the range this indicator reports. */
  side: z.enum(['high', 'low']),
  /** Length of the opening range, from the session's first bar. A multiple of the timeframe. */
  minutes: z.number().int().positive(),
});
export type OpeningRangeConfig = z.infer<typeof openingRangeConfigSchema>;

/**
 * The high or low of the session's first `minutes`. Undefined while the range is still forming,
 * then fixed for the rest of the session.
 */
export class OpeningRange implements Indicator {
  private readonly config: OpeningRangeConfig;
  private firstStart: number | undefined;
  private high = -Infinity;
  private low = Infinity;
  private current: number | undefined;

  constructor(config: OpeningRangeConfig) {
    this.config = config;
  }

  get value(): number | undefined {
    return this.current;
  }

  update(bar: Bar): number | undefined {
    this.firstStart ??= nyTime(bar.time).minute;
    if (offsetIn(bar, this.firstStart) < this.config.minutes) {
      this.high = Math.max(this.high, bar.high);
      this.low = Math.min(this.low, bar.low);
      this.current = undefined;
    } else if (Number.isFinite(this.high)) {
      this.current = this.config.side === 'high' ? this.high : this.low;
    }
    return this.current;
  }

  startSession(): void {
    this.firstStart = undefined;
    this.high = -Infinity;
    this.low = Infinity;
    this.current = undefined;
  }
}

// --- noiseBand ---------------------------------------------------------------------------------

export const noiseBandConfigSchema = z.object({
  type: z.literal('noiseBand'),
  /** Which edge of the band this indicator reports. */
  side: z.enum(['upper', 'lower']),
  /** Past sessions averaged for each time of day. */
  lookbackDays: z.number().int().positive().default(14),
  /** Scales the band's width. */
  multiplier: z.number().positive().default(1),
});
export type NoiseBandConfig = z.infer<typeof noiseBandConfigSchema>;

/**
 * The "noise area" from Zarattini, Aziz and Barbon (2024): how far price usually strays from the
 * open by this time of day. For each bar, σ is the average of |close / open − 1| at the same time
 * of day over the last `lookbackDays` sessions. The band is
 *
 *   upper = max(open, previous close) × (1 + multiplier × σ)
 *   lower = min(open, previous close) × (1 − multiplier × σ)
 *
 * so an overnight gap widens it on the side it gapped. Undefined until there are `lookbackDays`
 * past sessions for this time of day. Only past sessions feed σ, never the current one.
 */
export class NoiseBand implements Indicator {
  private readonly config: NoiseBandConfig;
  /** Past sessions' moves from the open, by minutes after the first bar, oldest first. */
  private readonly history = new Map<number, number[]>();
  private readonly today = new Map<number, number>();
  private firstStart: number | undefined;
  private sessionOpen: number | undefined;
  private previousClose: number | undefined;
  private lastClose: number | undefined;
  private current: number | undefined;

  constructor(config: NoiseBandConfig) {
    this.config = config;
  }

  get value(): number | undefined {
    return this.current;
  }

  update(bar: Bar): number | undefined {
    this.firstStart ??= nyTime(bar.time).minute;
    this.sessionOpen ??= bar.open;
    const offset = offsetIn(bar, this.firstStart);
    const open = this.sessionOpen;

    const past = this.history.get(offset);
    if (past && past.length >= this.config.lookbackDays) {
      const sigma = past.reduce((a, b) => a + b, 0) / past.length;
      const width = this.config.multiplier * sigma;
      const previous = this.previousClose ?? open;
      this.current =
        this.config.side === 'upper'
          ? Math.max(open, previous) * (1 + width)
          : Math.min(open, previous) * (1 - width);
    } else {
      this.current = undefined;
    }

    this.today.set(offset, Math.abs(bar.close / open - 1));
    this.lastClose = bar.close;
    return this.current;
  }

  startSession(): void {
    for (const [offset, move] of this.today) {
      const past = this.history.get(offset) ?? [];
      past.push(move);
      if (past.length > this.config.lookbackDays) past.shift();
      this.history.set(offset, past);
    }
    this.today.clear();
    this.previousClose = this.lastClose;
    this.firstStart = undefined;
    this.sessionOpen = undefined;
    this.current = undefined;
  }
}

// --- timeRange ---------------------------------------------------------------------------------

const clockTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Expected a New York time like 09:00');

export const timeRangeConfigSchema = z
  .object({
    type: z.literal('timeRange'),
    /** Which edge of the range this indicator reports. */
    side: z.enum(['high', 'low']),
    /**
     * New York clock times. Bars starting from `start` up to, but not including, `end` count, so
     * use a timeframe that divides the window evenly.
     */
    start: clockTimeSchema,
    end: clockTimeSchema,
  })
  .refine((c) => parseClockTime(c.start) < parseClockTime(c.end), {
    message: 'start must be before end',
  });
export type TimeRangeConfig = z.infer<typeof timeRangeConfigSchema>;

/**
 * The high or low of a fixed clock window each day, such as the 09:00–09:30 pre-market box.
 * Undefined until the window has ended, then fixed for the rest of the session. A window before
 * 09:30 needs `session: 'extended'`, or no bars reach it.
 *
 * It knows a bar has ended the window when a bar starting at or after `end` arrives.
 */
export class TimeRange implements Indicator {
  private readonly start: number;
  private readonly end: number;
  private readonly side: 'high' | 'low';
  private high = -Infinity;
  private low = Infinity;
  private current: number | undefined;

  constructor(config: TimeRangeConfig) {
    this.start = parseClockTime(config.start);
    this.end = parseClockTime(config.end);
    this.side = config.side;
  }

  get value(): number | undefined {
    return this.current;
  }

  update(bar: Bar): number | undefined {
    const minute = nyTime(bar.time).minute;
    if (minute >= this.start && minute < this.end) {
      this.high = Math.max(this.high, bar.high);
      this.low = Math.min(this.low, bar.low);
    } else if (minute >= this.end && Number.isFinite(this.high)) {
      this.current = this.side === 'high' ? this.high : this.low;
    }
    return this.current;
  }

  startSession(): void {
    this.high = -Infinity;
    this.low = Infinity;
    this.current = undefined;
  }
}
