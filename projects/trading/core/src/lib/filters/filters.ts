import { z } from 'zod';

import { EXIT_REASONS } from '../exits/exit-rule';

import { EntryContext, EntryFilter } from './entry-filter';

// --- timeWindow --------------------------------------------------------------------------------

export const timeWindowConfigSchema = z.object({
  type: z.literal('timeWindow'),
  /** No entries until this many minutes after the regular open. */
  startDelayMinutes: z.number().nonnegative().default(0),
  /** No entries in the last this-many minutes before the regular close. */
  endBeforeCloseMinutes: z.number().nonnegative().default(0),
  /**
   * No entries later than this many minutes after the regular open: 60 allows a signal from a
   * bar that closes at 10:30, but not later. Leave out for no limit.
   */
  latestAfterOpenMinutes: z.number().nonnegative().optional(),
});

/** Only enters during the regular session, optionally trimmed at either end. */
export class TimeWindow implements EntryFilter {
  readonly name = 'timeWindow';
  private readonly config: z.infer<typeof timeWindowConfigSchema>;

  constructor(config: z.infer<typeof timeWindowConfigSchema>) {
    this.config = config;
  }

  allow({ clock }: EntryContext): boolean {
    if (!clock.hours) return false;
    const { latestAfterOpenMinutes } = this.config;
    return (
      clock.minute >= clock.hours.open + this.config.startDelayMinutes &&
      clock.minute < clock.hours.close - this.config.endBeforeCloseMinutes &&
      (latestAfterOpenMinutes === undefined ||
        clock.minute <= clock.hours.open + latestAfterOpenMinutes)
    );
  }
}

// --- cooldown ----------------------------------------------------------------------------------

export const cooldownConfigSchema = z.object({
  type: z.literal('cooldown'),
  /** Bars to sit out after an exit before entering the same ticker again. */
  bars: z.number().int().positive(),
  /** Only exits with these reasons start a cooldown. Leave out to cool down after any exit. */
  afterReasons: z.array(z.enum(EXIT_REASONS)).optional(),
});

export class Cooldown implements EntryFilter {
  readonly name = 'cooldown';
  private readonly config: z.infer<typeof cooldownConfigSchema>;

  constructor(config: z.infer<typeof cooldownConfigSchema>) {
    this.config = config;
  }

  allow({ lastExit, barIndex }: EntryContext): boolean {
    if (!lastExit) return true;
    const { afterReasons } = this.config;
    if (afterReasons && !afterReasons.includes(lastExit.reason)) return true;
    return barIndex - lastExit.barIndex > this.config.bars;
  }
}

// --- indicatorSide -----------------------------------------------------------------------------

export const indicatorSideConfigSchema = z.object({
  type: z.literal('indicatorSide'),
  /** Indicator names. Calls need `fast` above `slow`, puts need it below. */
  fast: z.string().min(1),
  slow: z.string().min(1),
});

/** Only trades in the direction two indicators agree on, e.g. price above VWAP for calls. */
export class IndicatorSide implements EntryFilter {
  readonly name = 'indicatorSide';
  private readonly config: z.infer<typeof indicatorSideConfigSchema>;

  constructor(config: z.infer<typeof indicatorSideConfigSchema>) {
    this.config = config;
  }

  allow({ direction, indicators }: EntryContext): boolean {
    const fast = indicators[this.config.fast];
    const slow = indicators[this.config.slow];
    if (fast === undefined || slow === undefined) return false;
    return direction === 'bullish' ? fast > slow : fast < slow;
  }
}

// --- maxEntriesPerDay --------------------------------------------------------------------------

export const maxEntriesPerDayConfigSchema = z.object({
  type: z.literal('maxEntriesPerDay'),
  /** Per ticker. */
  count: z.number().int().positive(),
});

export class MaxEntriesPerDay implements EntryFilter {
  readonly name = 'maxEntriesPerDay';
  private readonly count: number;

  constructor(config: z.infer<typeof maxEntriesPerDayConfigSchema>) {
    this.count = config.count;
  }

  allow({ entriesToday }: EntryContext): boolean {
    return entriesToday < this.count;
  }
}
