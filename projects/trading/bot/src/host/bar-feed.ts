import { Bar, MINUTE_MS } from '@projects/trading-core';

import { BarSource, Log } from './ports';

export type BarFeedDeps = {
  ticker: string;
  /** REST bars with `start <= time < end`. */
  fetchBars: (start: number, end: number) => Promise<Bar[]>;
  /** Hands a bar to the engine. Called strictly in time order, once per minute at most. */
  deliver: (bar: Bar, source: BarSource) => Promise<void>;
  log: Log;
  now: () => number;
};

export type BarFeedStats = {
  delivered: number;
  backfilled: number;
  duplicates: number;
  gapsFilled: number;
  lastBarTime: number | undefined;
  /** When the last bar arrived, from any source. */
  lastReceivedAt: number | undefined;
};

/**
 * Turns the stream into the strictly ordered, gap-free series the engine expects. A bar that skips
 * ahead triggers a REST fetch for the minutes in between; late or repeated bars are dropped.
 * Minutes with no trades simply have no bar, so a fetch that comes back empty is fine.
 */
export class BarFeed {
  private readonly deps: BarFeedDeps;
  private queue: Promise<unknown> = Promise.resolve();
  readonly stats: BarFeedStats = {
    delivered: 0,
    backfilled: 0,
    duplicates: 0,
    gapsFilled: 0,
    lastBarTime: undefined,
    lastReceivedAt: undefined,
  };

  constructor(deps: BarFeedDeps) {
    this.deps = deps;
  }

  /** Bars up to and including `time` are taken as already delivered (by warmup). */
  startAfter(time: number | undefined): void {
    this.stats.lastBarTime = time;
  }

  push(bar: Bar): Promise<void> {
    return this.serialize(async () => {
      this.stats.lastReceivedAt = this.deps.now();
      const last = this.stats.lastBarTime;
      if (last !== undefined && bar.time <= last) {
        this.stats.duplicates += 1;
        return;
      }
      if (last !== undefined && bar.time > last + MINUTE_MS) {
        await this.fill(last + MINUTE_MS, bar.time);
      }
      await this.emit(bar, 'stream');
    });
  }

  /** Fetches anything missed since the last bar, e.g. after a reconnect or when the stream is quiet. */
  catchUp(): Promise<number> {
    return this.serialize(() => {
      const last = this.stats.lastBarTime;
      // The bar for the current minute isn't closed yet.
      const end = Math.floor(this.deps.now() / MINUTE_MS) * MINUTE_MS;
      const start =
        last === undefined ? end - 60 * MINUTE_MS : last + MINUTE_MS;
      return start >= end ? Promise.resolve(0) : this.fill(start, end);
    });
  }

  private async fill(start: number, end: number): Promise<number> {
    let bars: Bar[];
    try {
      bars = await this.deps.fetchBars(start, end);
    } catch (error) {
      this.deps.log.warn('backfill failed', {
        ticker: this.deps.ticker,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        error: String(error),
      });
      return 0;
    }
    let count = 0;
    for (const bar of bars) {
      const last = this.stats.lastBarTime;
      if (bar.time < start || bar.time >= end) continue;
      if (last !== undefined && bar.time <= last) continue;
      await this.emit(bar, 'backfill');
      count += 1;
    }
    if (count > 0) {
      this.stats.gapsFilled += 1;
      this.stats.backfilled += count;
      this.stats.lastReceivedAt = this.deps.now();
      this.deps.log.info('backfilled bars', {
        ticker: this.deps.ticker,
        count,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      });
    }
    return count;
  }

  private async emit(bar: Bar, source: BarSource): Promise<void> {
    this.stats.lastBarTime = bar.time;
    this.stats.delivered += 1;
    await this.deps.deliver(bar, source);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
