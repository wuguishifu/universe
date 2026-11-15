import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMA_VWAP_CROSSOVER,
  parseStrategyConfig,
} from '@projects/trading-core';

import { BacktestResult, BacktestTrade } from '../sim/backtest';
import { simulationConfigSchema } from '../sim/simulation-config';

import {
  computeStats,
  finalizeStats,
  mergePartials,
  partialFromResult,
  StatsPartial,
} from './stats';

const strategy = parseStrategyConfig(EMA_VWAP_CROSSOVER);

function merge(parts: StatsPartial[]) {
  const merged = mergePartials(parts);
  assert.ok(merged);
  return finalizeStats(merged, 1_000);
}

const simulation = simulationConfigSchema.parse({ startingCash: 1_000 });

const trade = (netPnl: number): BacktestTrade => ({
  positionId: 'p',
  ticker: 'SPY',
  direction: netPnl > 0 ? 'bullish' : 'bearish',
  symbol: 'X',
  qty: 1,
  multiplier: 100,
  entryTime: 0,
  entryPrice: 1,
  exitTime: 0,
  exitPrice: 1,
  reason: netPnl > 0 ? 'profitTarget' : 'pnlStop',
  pnl: netPnl,
  pnlPct: netPnl / 100,
  fees: 0,
  netPnl,
});

/** A run where each trade closes on its own day and equity is marked after each. */
function result(pnls: number[]): BacktestResult {
  let equity = 1_000;
  const curve = pnls.map((netPnl, i) => ({
    time: i,
    equity: (equity += netPnl),
  }));
  return {
    strategy,
    simulation,
    from: '',
    to: '',
    days: pnls.map((netPnl, i) => ({
      date: `d${i}`,
      trades: 1,
      netPnl,
      equity: curve[i]?.equity ?? 0,
    })),
    trades: pnls.map(trade),
    equity: curve,
    events: [],
    openPositions: [],
    warnings: [],
  };
}

/** Rounds every number, since summing in a different order moves the last float digit. */
const rounded = (value: unknown): unknown =>
  typeof value === 'number'
    ? Number(value.toFixed(9))
    : Array.isArray(value)
      ? value.map(rounded)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, rounded(v)]),
          )
        : value;

describe('mergePartials', () => {
  it('matches one long run when the run is cut into chunks', () => {
    const pnls = [50, -30, 80, -120, -40, 60, 10, -90, 200, -10];
    const whole = computeStats(result(pnls));
    // Each chunk's equity starts from its own startingCash, like an independent backtest.
    const parts = [pnls.slice(0, 3), pnls.slice(3, 5), pnls.slice(5)].map(
      (chunk) => partialFromResult(result(chunk)),
    );
    const merged = merge(parts);

    assert.deepEqual(rounded(merged), rounded(whole));
  });

  it('finds a drawdown that spans chunk boundaries', () => {
    // Peak at +100 in the first chunk, then falls 50 and 70 over the next two.
    const parts = [[100], [-50], [-70, 30]].map((chunk) =>
      partialFromResult(result(chunk)),
    );
    const merged = merge(parts);
    assert.equal(merged.maxDrawdown, 120);
    assert.equal(merged.maxDrawdownPct, 120 / 1_100);
  });

  it('computes a t-stat from the per-trade spread', () => {
    const stats = computeStats(result([10, 20, 30]));
    // mean 20, sd 10, n 3 → 20 / (10 / √3)
    assert.equal(stats.tStat.toFixed(4), (20 / (10 / Math.sqrt(3))).toFixed(4));
  });
});
