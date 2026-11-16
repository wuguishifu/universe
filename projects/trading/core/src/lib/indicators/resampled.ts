import { BarAggregator } from '../market/bar-aggregator';
import { Bar } from '../market/types';

import { Indicator } from './indicator';

/**
 * Runs an indicator on longer bars than the ones it is fed, e.g. a 15-minute EMA inside a
 * 5-minute strategy. Its value only changes when a longer bar completes, so between completions
 * it reports the value as of the last completed one.
 */
export class Resampled implements Indicator {
  private readonly inner: Indicator;
  private readonly aggregator: BarAggregator;

  constructor(inner: Indicator, minutes: number, inputMinutes: number) {
    this.inner = inner;
    this.aggregator = new BarAggregator(minutes, inputMinutes);
  }

  get value(): number | undefined {
    return this.inner.value;
  }

  update(bar: Bar): number | undefined {
    for (const longer of this.aggregator.push(bar)) this.inner.update(longer);
    return this.inner.value;
  }

  startSession(): void {
    // A bar still open from the last session (its final minutes had no trades) belongs to it.
    const unfinished = this.aggregator.flush();
    if (unfinished) this.inner.update(unfinished);
    this.inner.startSession();
  }
}
