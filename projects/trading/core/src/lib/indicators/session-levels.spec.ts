import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at, bar, DAY } from '../../testing/fixtures';
import { MINUTE_MS } from '../market/ny-time';

import { NoiseBand, OpeningRange, Price } from './session-levels';

const OPEN = at(DAY, '09:30');
const DAY_MS = 86_400_000;

describe('Price', () => {
  it('reports the bar price', () => {
    const price = new Price({ type: 'price', source: 'hl2' });
    assert.equal(price.update(bar(OPEN, 5, { high: 8, low: 4 })), 6);
  });
});

describe('OpeningRange', () => {
  it('is undefined while forming, then holds the range for the session', () => {
    const high = new OpeningRange({
      type: 'openingRange',
      side: 'high',
      minutes: 10,
    });
    const low = new OpeningRange({
      type: 'openingRange',
      side: 'low',
      minutes: 10,
    });
    const bars = [
      bar(OPEN, 100, { high: 101, low: 99 }),
      bar(OPEN + 5 * MINUTE_MS, 102, { high: 103, low: 100 }),
      bar(OPEN + 10 * MINUTE_MS, 110, { high: 111, low: 95 }),
      bar(OPEN + 15 * MINUTE_MS, 90, { high: 91, low: 89 }),
    ];
    assert.deepEqual(
      bars.map((b) => high.update(b)),
      [undefined, undefined, 103, 103],
    );
    assert.deepEqual(
      bars.map((b) => low.update(b)),
      [undefined, undefined, 99, 99],
    );
    high.startSession();
    assert.equal(high.update(bar(OPEN + DAY_MS, 100)), undefined);
  });
});

describe('NoiseBand', () => {
  /** One session of 1-minute bars opening at `open` and closing each minute at `closes`. */
  const session = (
    band: NoiseBand,
    day: number,
    open: number,
    closes: number[],
  ) => {
    band.startSession();
    return closes.map((close, i) =>
      band.update(
        bar(OPEN + day * DAY_MS + i * MINUTE_MS, close, {
          open: i === 0 ? open : close,
        }),
      ),
    );
  };

  it('averages past moves at the same time of day, then scales the open', () => {
    const upper = new NoiseBand({
      type: 'noiseBand',
      side: 'upper',
      lookbackDays: 2,
      multiplier: 1,
    });
    // Day 0: moves of 1% and 2% from the open. Day 1: 3% and 4%. No history yet on either day.
    assert.deepEqual(session(upper, 0, 100, [101, 102]), [
      undefined,
      undefined,
    ]);
    assert.deepEqual(session(upper, 1, 100, [103, 96]), [undefined, undefined]);
    // Day 2 opens at 200, previous close 96: σ is 2% for the first minute and 3% for the second.
    const values = session(upper, 2, 200, [200, 200]);
    assert.equal(values[0]?.toFixed(6), (200 * 1.02).toFixed(6));
    assert.equal(values[1]?.toFixed(6), (200 * 1.03).toFixed(6));
  });

  it('widens the band on the side of an overnight gap', () => {
    const lower = new NoiseBand({
      type: 'noiseBand',
      side: 'lower',
      lookbackDays: 1,
      multiplier: 2,
    });
    session(lower, 0, 100, [101]);
    // Opens at 110 after closing at 101: the lower edge hangs off the previous close.
    const [value] = session(lower, 1, 110, [110]);
    assert.equal(value?.toFixed(6), (101 * (1 - 2 * 0.01)).toFixed(6));
  });

  it('only remembers the last lookbackDays sessions', () => {
    const upper = new NoiseBand({
      type: 'noiseBand',
      side: 'upper',
      lookbackDays: 1,
      multiplier: 1,
    });
    session(upper, 0, 100, [110]);
    session(upper, 1, 100, [101]);
    const [value] = session(upper, 2, 100, [100]);
    // Only day 1's 1% move is left; the previous close of 101 is the upper anchor.
    assert.equal(value?.toFixed(6), (101 * 1.01).toFixed(6));
  });
});
