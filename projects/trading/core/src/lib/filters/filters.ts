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
    return (
      clock.minute >= clock.hours.open + this.config.startDelayMinutes &&
      clock.minute < clock.hours.close - this.config.endBeforeCloseMinutes
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
