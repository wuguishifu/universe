import { z } from 'zod';

import { Bar } from '../market/types';
import { Clock, Direction } from '../strategy/types';

import { SignalGenerator } from './signal';

export const timedMomentumConfigSchema = z.object({
  type: z.literal('timedMomentum'),
  /** Where the early move is measured from: the previous session's last close, or today's open. */
  reference: z.enum(['previousClose', 'open']).default('previousClose'),
  /** The early move ends this many minutes after the open. */
  measureMinutes: z.number().int().positive().default(30),
  /** Signals once, on the first bar that closes this many minutes or fewer before the close. */
  entryBeforeCloseMinutes: z.number().int().positive().default(30),
  /** Skip days whose early move is smaller than this fraction. */
  minMovePct: z.number().nonnegative().default(0),
  /** Trade against the early move instead of with it. */
  invert: z.boolean().default(false),
});
export type TimedMomentumConfig = z.infer<typeof timedMomentumConfigSchema>;

/**
 * Intraday momentum (Gao, Han, Li and Zhou, 2018): the return from the previous close to the first
 * half hour tends to continue into the last half hour. Signals once a session, late in the day, in
 * the direction of the early move.
 */
export class TimedMomentum implements SignalGenerator {
  private readonly config: TimedMomentumConfig;
  private previousClose: number | undefined;
  private lastClose: number | undefined;
  private sessionOpen: number | undefined;
  private measured: number | undefined;
  private fired = false;

  constructor(config: TimedMomentumConfig) {
    this.config = config;
  }

  update(_indicators: unknown, bar: Bar, clock?: Clock): Direction | null {
    this.sessionOpen ??= bar.open;
    this.lastClose = bar.close;
    const hours = clock?.hours;
    if (!clock || !hours) return null;

    if (
      this.measured === undefined &&
      clock.minute >= hours.open + this.config.measureMinutes
    ) {
      this.measured = bar.close;
    }
    if (
      this.fired ||
      this.measured === undefined ||
      clock.minute < hours.close - this.config.entryBeforeCloseMinutes
    ) {
      return null;
    }
    this.fired = true;

    const reference =
      this.config.reference === 'open' ? this.sessionOpen : this.previousClose;
    if (reference === undefined) return null;
    const move = this.measured / reference - 1;
    if (move === 0 || Math.abs(move) < this.config.minMovePct) return null;
    const up = move > 0 !== this.config.invert;
    return up ? 'bullish' : 'bearish';
  }

  startSession(): void {
    this.previousClose = this.lastClose;
    this.sessionOpen = undefined;
    this.measured = undefined;
    this.fired = false;
  }
}
