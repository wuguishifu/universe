import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allocationConfigSchema } from '@projects/trading-core';

import { DailyBar } from '../data/data-store';

import { alignDaily, runDaily } from './daily-backtest';
import { dailyStats } from './daily-stats';

const day = (date: string, open: number, close = open): DailyBar => ({
  date,
  time: Date.parse(date),
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1,
});

describe('alignDaily', () => {
  it('starts when every ticker has data and drops dates any ticker is missing', () => {
    const series = alignDaily({
      A: [day('2026-01-02', 1), day('2026-01-05', 2), day('2026-01-06', 3)],
      B: [day('2026-01-01', 9), day('2026-01-02', 8), day('2026-01-06', 7)],
    });
    assert.deepEqual(series.dates, ['2026-01-02', '2026-01-06']);
    assert.deepEqual(series.dropped, ['2026-01-05']);
    assert.deepEqual(series.close['A'], [1, 3]);
    assert.deepEqual(series.close['B'], [8, 7]);
  });
});

describe('runDaily', () => {
  // 2026-01-30 is the last trading day of January.
  const series = alignDaily({
    A: [
      day('2026-01-29', 10),
      day('2026-01-30', 10),
      day('2026-02-02', 20, 22),
      day('2026-02-03', 22, 11),
    ],
    BIL: ['2026-01-29', '2026-01-30', '2026-02-02', '2026-02-03'].map((d) =>
      day(d, 100),
    ),
  });
  const config = allocationConfigSchema.parse({
    cash: 'BIL',
    rule: { type: 'fixed', weights: { A: 1 } },
  });
  const options = {
    from: '2026-01-01',
    to: '2026-02-03',
    startingCash: 1000,
    costBps: 10,
  };

  it('decides on the month-end close and fills at the next open, after costs', () => {
    const result = runDaily(config, series, options);
    assert.equal(result.rebalances.length, 1);
    assert.deepEqual(result.rebalances[0], {
      decided: '2026-01-30',
      traded: '2026-02-02',
      weights: { A: 1 },
      turnover: 1,
      cost: 1,
    });
    // 999 / 20 = 49.95 shares, marked at 22 and then 11.
    assert.deepEqual(
      result.equity.map((p) => [p.date, Number(p.value.toFixed(6))]),
      [
        ['2026-02-02', 1098.9],
        ['2026-02-03', 549.45],
      ],
    );

    const stats = dailyStats(result);
    assert.ok(stats);
    assert.equal(Number(stats.totalReturn.toFixed(6)), -0.45055);
    assert.equal(Number(stats.maxDrawdown.toFixed(6)), 0.5);
    assert.equal(stats.maxDrawdownDate, '2026-02-03');
    assert.equal(stats.costs, 1);
  });

  it('does not trade after `to`', () => {
    const result = runDaily(config, series, { ...options, to: '2026-01-30' });
    assert.equal(result.rebalances.length, 0);
    assert.equal(dailyStats(result), null);
  });

  it('holds cash when the rule says so', () => {
    const trend = allocationConfigSchema.parse({
      cash: 'BIL',
      rule: { type: 'trend', assets: ['A'], smaDays: 2 },
    });
    // A is flat into the month-end, so it isn't above its average.
    const result = runDaily(trend, series, options);
    assert.deepEqual(result.rebalances[0]?.weights, { BIL: 1 });
    assert.equal(result.equity.at(-1)?.value, 999);
  });
});
