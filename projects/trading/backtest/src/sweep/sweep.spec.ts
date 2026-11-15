import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BacktestStats } from '../report/stats';

import {
  chunkRange,
  computeMarginals,
  distinctTop,
  SweepRow,
  twinSummary,
} from './sweep';
import { applyPatch, expandCombos, sweepConfigSchema } from './sweep-config';

const config = sweepConfigSchema.parse({
  train: { from: '2026-08-03', to: '2026-10-09' },
  base: {
    preset: 'ema-vwap-crossover',
    exits: [{ type: 'flatBeforeClose', minutes: 10 }],
  },
  axes: {
    timeframe: { '1m': { timeframeMinutes: 1 }, '5m': { timeframeMinutes: 5 } },
    stop: {
      stop30: { exits: [{ type: 'pnlStop', pct: 0.3 }] },
      none: {},
    },
    expiry: {
      '0dte': {
        contract: { expiry: { type: 'nearest', minDte: 0, maxDte: 0 } },
      },
    },
  },
});

describe('applyPatch', () => {
  it('appends exits and entry filters, merges objects, and replaces everything else', () => {
    const merged = applyPatch(
      {
        exits: [1],
        timeframeMinutes: 5,
        contract: { strike: { type: 'atm' }, expiry: { minDte: 1 } },
      },
      { exits: [2], timeframeMinutes: 1, contract: { expiry: { maxDte: 0 } } },
    );
    assert.deepEqual(merged, {
      exits: [1, 2],
      timeframeMinutes: 1,
      contract: { strike: { type: 'atm' }, expiry: { minDte: 1, maxDte: 0 } },
    });
  });
});

describe('expandCombos', () => {
  const { combos, invalid } = expandCombos(config);

  it('builds one validated config per combination', () => {
    assert.deepEqual(invalid, []);
    assert.deepEqual(
      combos.map((c) => Object.values(c.choices).join(' ')),
      ['1m stop30 0dte', '1m none 0dte', '5m stop30 0dte', '5m none 0dte'],
    );
  });

  it('lays each patch over the preset', () => {
    const [first] = combos;
    assert.equal(first?.strategy.timeframeMinutes, 1);
    assert.deepEqual(
      first?.strategy.exits.map((e) => e.type),
      ['flatBeforeClose', 'pnlStop'],
    );
    assert.deepEqual(first?.strategy.contract.expiry, {
      type: 'nearest',
      minDte: 0,
      maxDte: 0,
    });
    // Untouched preset fields survive.
    assert.equal(first?.strategy.signal.type, 'crossover');
  });

  it('reports combinations that fail validation instead of throwing', () => {
    const broken = sweepConfigSchema.parse({
      ...config,
      axes: { bad: { typo: { timeframeMinutes: 4 } } },
    });
    const result = expandCombos(broken);
    assert.equal(result.combos.length, 0);
    assert.match(
      result.invalid[0] ?? '',
      /bad=typo: [\s\S]*timeframeMinutes must be one of/,
    );
  });
});

const stats = (netPnl: number): BacktestStats => ({
  startingCash: 25_000,
  endingEquity: 25_000 + netPnl,
  netPnl,
  returnPct: netPnl / 25_000,
  fees: 0,
  trades: 10,
  wins: 0,
  losses: 0,
  winRate: 0,
  avgWin: 0,
  avgLoss: 0,
  largestWin: 0,
  largestLoss: 0,
  profitFactor: 0,
  expectancy: 0,
  tStat: 0,
  avgPnlPct: 0,
  maxDrawdown: 0,
  maxDrawdownPct: 0,
  tradingDays: 0,
  winningDays: 0,
  losingDays: 0,
  bestDay: 0,
  worstDay: 0,
  byReason: {},
  byDirection: {},
  byTicker: {},
  signals: 0,
  skipped: {},
  daysLeftOpen: 0,
});

describe('computeMarginals', () => {
  it('averages each label over the configs that used it', () => {
    const { combos } = expandCombos(config);
    const pnls = [100, -50, 30, -10];
    const rows: SweepRow[] = combos.map((combo, i) => ({
      combo,
      train: stats(pnls[i] ?? 0),
    }));
    const byLabel = Object.fromEntries(
      computeMarginals(config, rows).map((m) => [`${m.axis}=${m.label}`, m]),
    );
    assert.equal(byLabel['timeframe=1m']?.meanNetPnl, 25);
    assert.equal(byLabel['stop=stop30']?.meanNetPnl, 65);
    assert.equal(byLabel['stop=none']?.profitable, 0);
    assert.equal(byLabel['expiry=0dte']?.configs, 4);
  });
});

describe('distinctTop', () => {
  it('folds configs with identical results into the first one', () => {
    const { combos } = expandCombos(config);
    const [a, b, c, d] = combos;
    assert.ok(a && b && c && d);
    // a and c tie exactly; they differ only on timeframe.
    const ranked: SweepRow[] = [
      { combo: a, train: stats(100) },
      { combo: c, train: stats(100) },
      { combo: b, train: stats(50) },
      { combo: d, train: stats(10) },
    ];
    const top = distinctTop(ranked, 2);
    assert.deepEqual(
      top.map((row) => row.train?.netPnl),
      [100, 50],
    );
    assert.equal(
      twinSummary(top[0] ?? { combo: a, train: undefined }),
      'timeframe: 1m/5m',
    );
  });
});

describe('chunkRange', () => {
  const dates = Array.from(
    { length: 30 },
    (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`,
  );

  it('cuts the range into back-to-back chunks, a multiple of the worker count', () => {
    const chunks = chunkRange(
      dates,
      { from: '2026-01-03', to: '2026-01-28' },
      4,
      3,
    );
    assert.equal(chunks.length, 8);
    assert.equal(chunks[0]?.from, '2026-01-03');
    assert.equal(chunks.at(-1)?.to, '2026-01-28');
    for (let i = 1; i < chunks.length; i++) {
      const prev = dates.indexOf(chunks[i - 1]?.to ?? '');
      assert.equal(dates.indexOf(chunks[i]?.from ?? ''), prev + 1);
    }
  });

  it('splits chunks that would span a new year', () => {
    const days = [
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-02',
      '2026-01-05',
    ];
    const chunks = chunkRange(
      days,
      { from: '2025-12-29', to: '2026-01-05' },
      1,
      5,
    );
    assert.deepEqual(chunks, [
      { from: '2025-12-29', to: '2025-12-31' },
      { from: '2026-01-02', to: '2026-01-05' },
    ]);
  });

  it('never makes more chunks than days', () => {
    assert.equal(
      chunkRange(dates, { from: '2026-01-01', to: '2026-01-02' }, 8, 20).length,
      2,
    );
  });
});
