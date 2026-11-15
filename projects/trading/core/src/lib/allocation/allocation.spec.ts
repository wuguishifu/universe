import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AllocationConfig,
  allocationConfigSchema,
  allocationTickers,
  isMonthEnd,
  lookbackReturn,
  simpleAverage,
  targetWeights,
} from './allocation';

const parse = (input: unknown): AllocationConfig =>
  allocationConfigSchema.parse(input);

/** Closes rising (or falling) by `step` a day for `days` days, starting at 100. */
const ramp = (days: number, step: number): number[] =>
  Array.from({ length: days }, (_, i) => 100 + i * step);

describe('lookbackReturn and simpleAverage', () => {
  it('measures from lookback + skip days back to skip days back', () => {
    const closes = [100, 110, 121, 133.1];
    assert.equal(lookbackReturn(closes, 1), 133.1 / 121 - 1);
    assert.equal(lookbackReturn(closes, 2, 1), 121 / 100 - 1);
    assert.equal(lookbackReturn(closes, 3, 1), undefined);
  });

  it('averages the last N closes', () => {
    assert.equal(simpleAverage([1, 2, 3, 4], 2), 3.5);
    assert.equal(simpleAverage([1, 2], 3), undefined);
  });
});

describe('targetWeights', () => {
  it('returns fixed weights and rejects ones that do not add up to 1', () => {
    const config = parse({
      cash: 'BIL',
      rule: { type: 'fixed', weights: { SPY: 0.6, IEF: 0.4 } },
    });
    assert.deepEqual(targetWeights(config, {}), { SPY: 0.6, IEF: 0.4 });
    assert.throws(() =>
      parse({ cash: 'BIL', rule: { type: 'fixed', weights: { SPY: 0.6 } } }),
    );
  });

  it('holds trending assets and moves the rest to cash', () => {
    const config = parse({
      cash: 'BIL',
      rule: { type: 'trend', assets: ['UP', 'DOWN'], smaDays: 3 },
    });
    assert.deepEqual(
      targetWeights(config, { UP: ramp(5, 1), DOWN: ramp(5, -1) }),
      { UP: 0.5, BIL: 0.5 },
    );
  });

  it('waits for enough history', () => {
    const config = parse({
      cash: 'BIL',
      rule: { type: 'trend', assets: ['UP'], smaDays: 10 },
    });
    assert.equal(targetWeights(config, { UP: ramp(5, 1) }), null);
  });

  it('picks the top assets by return, skipping the latest days', () => {
    const config = parse({
      cash: 'BIL',
      rule: {
        type: 'momentum',
        assets: ['A', 'B', 'C'],
        top: 2,
        lookbackDays: 2,
        skipDays: 1,
      },
    });
    // Over the skipped-to window, C leads and A beats B; B's last-day jump doesn't count.
    const history = {
      A: [100, 105, 110, 110],
      B: [100, 101, 102, 200],
      C: [100, 110, 120, 120],
    };
    assert.deepEqual(targetWeights(config, history), { C: 0.5, A: 0.5 });
  });

  it('replaces picks that lose to cash with the fallback', () => {
    const config = parse({
      cash: 'BIL',
      rule: {
        type: 'momentum',
        assets: ['SPY', 'EFA'],
        top: 1,
        lookbackDays: 2,
        absolute: true,
        fallback: 'AGG',
      },
    });
    const bil = [100, 100.1, 100.2];
    assert.deepEqual(
      targetWeights(config, {
        SPY: [100, 102, 104],
        EFA: [100, 99, 98],
        BIL: bil,
      }),
      { SPY: 1 },
    );
    assert.deepEqual(
      targetWeights(config, {
        SPY: [100, 99, 98],
        EFA: [100, 100, 100.1],
        BIL: bil,
      }),
      { AGG: 1 },
    );
    assert.deepEqual(allocationTickers(config), ['SPY', 'EFA', 'AGG', 'BIL']);
  });
});

describe('isMonthEnd', () => {
  it('is true when the next trading day is in another month', () => {
    assert.equal(isMonthEnd('2026-10-30', '2026-11-02'), true);
    assert.equal(isMonthEnd('2026-10-29', '2026-10-30'), false);
    assert.equal(isMonthEnd('2026-10-30', undefined), false);
  });
});
