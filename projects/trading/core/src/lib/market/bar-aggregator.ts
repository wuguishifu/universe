import { MINUTE_MS, nyTime } from './ny-time';
import { Bar } from './types';

/**
 * Rolls closed 1-minute bars up into N-minute bars. Buckets line up with New York clock time
 * (a 5-minute bar covers 09:30–09:35, 09:35–09:40, ...), the same way charting tools draw them.
 *
 * A bucket is emitted as soon as its last minute arrives. If that minute never comes (no trades),
 * the bucket is emitted when the first bar of a later bucket arrives.
 */
export class BarAggregator {
  private readonly minutes: number;
  private readonly inputMinutes: number;
  private current: Bar | null = null;
  private lastStart = Number.NEGATIVE_INFINITY;

  /**
   * `inputMinutes` is the length of the bars pushed in, 1 by default. It must divide `minutes`,
   * so 5-minute bars can be rolled up into 15-minute ones.
   */
  constructor(minutes: number, inputMinutes = 1) {
    if (!Number.isInteger(minutes) || minutes < 1) {
      throw new Error(
        `Timeframe must be a whole number of minutes, got ${minutes}`,
      );
    }
    if (
      !Number.isInteger(inputMinutes) ||
      inputMinutes < 1 ||
      minutes % inputMinutes !== 0
    ) {
      throw new Error(
        `Input bars of ${inputMinutes} minutes don't divide a ${minutes}-minute timeframe`,
      );
    }
    this.minutes = minutes;
    this.inputMinutes = inputMinutes;
  }

  /** Returns the bar still being built, if any, and starts afresh. */
  flush(): Bar | null {
    const current = this.current;
    this.current = null;
    return current;
  }

  /** Adds one closed input bar and returns the timeframe bars it completes, oldest first. */
  push(bar: Bar): Bar[] {
    const slot = Math.floor(nyTime(bar.time).minute) % this.minutes;
    const start =
      Math.floor(bar.time / MINUTE_MS) * MINUTE_MS - slot * MINUTE_MS;
    // A late bar for a bucket that was already emitted can't be folded in any more.
    const emitted =
      start < this.lastStart || (start === this.lastStart && !this.current);
    if (emitted) return [];

    const completed: Bar[] = [];
    if (this.current && this.current.time !== start) {
      completed.push(this.current);
      this.current = null;
    }

    if (this.current) {
      this.current.high = Math.max(this.current.high, bar.high);
      this.current.low = Math.min(this.current.low, bar.low);
      this.current.close = bar.close;
      this.current.volume += bar.volume;
    } else {
      this.current = { ...bar, time: start };
      this.lastStart = start;
    }

    if (slot === this.minutes - this.inputMinutes) {
      completed.push(this.current);
      this.current = null;
    }
    return completed;
  }
}
