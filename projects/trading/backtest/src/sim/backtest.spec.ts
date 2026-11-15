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
    // The target fires on the 1.60 print, but the sell fills on the next one, the 1.55 close:
    // 1.55 - 0.02325 = 1.52675, rounded down to 1.52.
    assert.equal(trade?.exitPrice, 1.52);
    assert.equal(trade?.pnl.toFixed(2), '50.00');
    assert.equal(trade?.netPnl.toFixed(2), '49.90');
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
    assert.equal(stats.endingEquity.toFixed(2), '25047.85');
    assert.equal(stats.trades, 1);
    assert.equal(stats.winRate, 1);
    assert.equal(stats.signals, 2);
    assert.deepEqual(stats.byReason, {
      profitTarget: {
        trades: 1,
        netPnl: result.trades[0]?.netPnl,
        winRate: 1,
        tStat: 0,
      },
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
      /^2026-11-16 09:39,2026-11-16 09:42,SPY,bullish,SPY261117C00100000,1,1.02,1.52,profitTarget,50.00,0.10,49.90,/,
    );
  });
});

describe('runBacktest with real quotes', () => {
  it('buys at the real ask, and a target sells at the next minute’s bid', async () => {
    const dir = writeFixture();
    const at = (minutesAfterOpen: number) =>
      Date.parse(isoAt(DAY, minutesAfterOpen));
    mkdirSync(join(dir, 'quotes', 'SPY'), { recursive: true });
    writeFileSync(
      join(dir, 'quotes', 'SPY', `${DAY}.json`),
      JSON.stringify({
        // Quoted 0.98 / 1.03 until 09:42, when it jumps to 1.58 / 1.62, then eases to 1.50 / 1.56.
        SPY261117C00100000: [
          [at(0), 0.98, 1.03],
          [at(12), 1.58, 1.62],
          [at(13), 1.5, 1.56],
        ],
        SPY261117P00094000: [[at(0), 0.99, 1.01]],
      }),
    );
    const result = await runBacktest({
      strategy,
      simulation: simulationConfigSchema.parse({
        prices: 'quotes',
        feePerContract: 0.05,
        warmupDays: 1,
      }),
      store: new DataStore(dir),
      from: DAY,
      to: DAY,
    });
    const [trade] = result.trades;
    assert.equal(trade?.symbol, 'SPY261117C00100000');
    assert.equal(trade?.entryPrice, 1.03);
    assert.equal(trade?.reason, 'profitTarget');
    // The 09:42 quote's midpoint of 1.60 is past the target, and the sell gets 09:43's bid.
    assert.equal(trade?.exitPrice, 1.5);
    assert.equal(trade?.netPnl.toFixed(2), '46.90');
    assert.deepEqual(
      result.openPositions.map((p) => [p.contract.symbol, p.entryPrice]),
      [['SPY261117P00094000', 1.01]],
    );
  });

  it('warns about a day with no quote file and trades nothing on it', async () => {
    const result = await runBacktest({
      strategy,
      simulation: simulationConfigSchema.parse({
        prices: 'quotes',
        warmupDays: 1,
      }),
      store: new DataStore(writeFixture()),
      from: DAY,
      to: DAY,
    });
    assert.equal(result.trades.length, 0);
    assert.deepEqual(result.warnings, [`No SPY option quotes on ${DAY}`]);
  });
});

describe('runBacktest at expiry', () => {
  it('settles an expiring option that stopped trading at intrinsic value, instead of holding it forever', async () => {
    // The same-day 100 call trades at 0.50 until 09:41 and never again. Going flat at 09:42 finds
    // no trade, so it settles at intrinsic: SPY's 09:41 close of 103 makes it worth 3.00.
    const result = await runBacktest({
      strategy: {
        ...strategy,
        exits: [{ type: 'flatBeforeClose', minutes: 378 }],
        contract: {
          expiry: { type: 'nearest', minDte: 0, maxDte: 0 },
          strike: { type: 'atm' },
        },
      },
      simulation: simulationConfigSchema.parse({
        spreadPct: 0,
        minSpread: 0,
        feePerContract: 0,
        warmupDays: 1,
      }),
      store: new DataStore(writeFixture()),
      from: DAY,
      to: DAY,
    });
    const [trade] = result.trades;
    assert.equal(trade?.symbol, 'SPY261116C00100000');
    assert.equal(trade?.reason, 'flatBeforeClose');
    assert.equal(trade?.entryPrice, 0.5);
    assert.equal(trade?.exitPrice, 3);
    assert.deepEqual(result.openPositions, []);
  });
});
