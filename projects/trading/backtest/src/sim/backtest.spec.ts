import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { before, describe, it } from 'node:test';

import { StrategyConfigInput } from '@projects/trading-core';

import { DataStore } from '../data/data-store';
import { writeRun } from '../report/report';
import { computeStats } from '../report/stats';

import { BacktestResult, runBacktest } from './backtest';
import { simulationConfigSchema } from './simulation-config';

const WARMUP_DAY = '2026-11-13';
const DAY = '2026-11-16';

const isoAt = (date: string, minutesAfterOpen: number): string =>
  new Date(
    Date.parse(`${date}T09:30:00-05:00`) + minutesAfterOpen * 60_000,
  ).toISOString();

const flatBar = (date: string, i: number, price: number) => ({
  t: isoAt(date, i),
  o: price,
  h: price,
  l: price,
  c: price,
  v: 1_000,
});

// With EMA3 against VWAP these closes cross up on the 09:38 bar (decided 09:39) and down on 09:44 (decided 09:45).
const PRICES = [
  100, 99, 98, 97, 96, 95, 96, 98, 100, 102, 104, 103, 100, 97, 94, 92,
];

function writeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'trading-backtest-'));
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(value));
  };

  write('calendar.json', [
    { date: WARMUP_DAY, open: '09:30', close: '16:00', session_open: '0400' },
    { date: DAY, open: '09:30', close: '16:00' },
    { date: '2026-11-17', open: '09:30', close: '16:00' },
  ]);
  write(
    `stocks/SPY/${WARMUP_DAY}.json`,
    Array.from({ length: 30 }, (_, i) => flatBar(WARMUP_DAY, i, 100)),
  );
  write(
    `stocks/SPY/${DAY}.json`,
    PRICES.map((price, i) => flatBar(DAY, i, price)),
  );

  const minutes = (count: number, price: number) =>
    Array.from({ length: count }, (_, i) => flatBar(DAY, i, price));
  write(`options/SPY/${DAY}.json`, {
    // The ATM call for tomorrow trades at 1.00, then spikes on the 09:42 bar: dips to 0.95 first, then 1.60.
    SPY261117C00100000: [
      ...minutes(12, 1),
      { t: isoAt(DAY, 12), o: 1, h: 1.6, l: 0.95, c: 1.55, v: 10 },
    ],
    // Same-day contracts, which minDte 1 must skip.
    SPY261116C00100000: minutes(12, 0.5),
    SPY261117P00094000: minutes(16, 1),
  });
  return dir;
}

const strategy = {
  tickers: ['SPY'],
  timeframeMinutes: 1,
  indicators: { ema: { type: 'ema', length: 3 }, vwap: { type: 'vwap' } },
  signal: { type: 'crossover', fast: 'ema', slow: 'vwap' },
  exits: [{ type: 'profitTarget', pct: 0.5 }],
  contract: { expiry: { type: 'nearest', minDte: 1 }, strike: { type: 'atm' } },
  sizing: { type: 'contracts', count: 1 },
} satisfies StrategyConfigInput;

describe('runBacktest', () => {
  let dir = '';
  let result: BacktestResult;

  before(async () => {
    dir = writeFixture();
    result = await runBacktest({
      strategy,
      simulation: simulationConfigSchema.parse({
        startingCash: 25_000,
        spreadPct: 0.03,
        minSpread: 0.01,
        feePerContract: 0.05,
        warmupDays: 1,
      }),
      store: new DataStore(dir),
      from: DAY,
      to: DAY,
    });
  });

  it('buys at the modeled ask and takes profit at the modeled bid', () => {
    assert.equal(result.trades.length, 1);
    const [trade] = result.trades;
    assert.equal(trade?.symbol, 'SPY261117C00100000');
    assert.equal(trade?.reason, 'profitTarget');
    // 1.00 + half of a 3% spread = 1.015, rounded up to 1.02.
    assert.equal(trade?.entryPrice, 1.02);
    // 1.60 - 0.024 = 1.576, rounded down to 1.57.
    assert.equal(trade?.exitPrice, 1.57);
    assert.equal(trade?.pnl.toFixed(2), '55.00');
    assert.equal(trade?.netPnl.toFixed(2), '54.90');
  });

  it('takes the next signal and reports what was left open', () => {
    assert.deepEqual(
      result.openPositions.map((p) => p.contract.symbol),
      ['SPY261117P00094000'],
    );
    assert.deepEqual(result.warnings, [
      `1 position(s) still open after ${DAY}`,
    ]);
  });

  it('tracks cash, fees and equity through the fills', () => {
    const stats = computeStats(result);
    // +55.00 on the call, less three fills' fees, and the put bought at 1.02 is now marked at 1.00.
    assert.equal(stats.endingEquity.toFixed(2), '25052.85');
    assert.equal(stats.trades, 1);
    assert.equal(stats.winRate, 1);
    assert.equal(stats.signals, 2);
    assert.deepEqual(stats.byReason, {
      profitTarget: { trades: 1, netPnl: result.trades[0]?.netPnl, winRate: 1 },
    });
  });

  it('writes a reproducible run folder', () => {
    const out = join(dir, 'run');
    writeRun(out, 'fixture', result, computeStats(result));
    const config = JSON.parse(readFileSync(join(out, 'config.json'), 'utf8'));
    assert.equal(config.strategy.exits[0].type, 'profitTarget');
    assert.equal(config.simulation.spreadPct, 0.03);
    const trades = readFileSync(join(out, 'trades.csv'), 'utf8')
      .trim()
      .split('\n');
    assert.equal(trades.length, 2);
    assert.match(
      trades[1] ?? '',
      /^2026-11-16 09:39,2026-11-16 09:42,SPY,bullish,SPY261117C00100000,1,1.02,1.57,profitTarget,55.00,0.10,54.90,/,
    );
  });
});
