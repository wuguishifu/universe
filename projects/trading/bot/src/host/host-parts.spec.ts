import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Bar, Position, weekdayCalendar } from '@projects/trading-core';

import { checkAccount } from './account-rules';
import { BarFeed } from './bar-feed';
import { nyEpochAt } from './ny-clock';
import { AccountInfo, BarSource, BrokerOrder, silentLog } from './ports';
import { missedExit, planReconcile } from './reconcile';

const DAY = '2026-11-16';
const bar = (time: number, close = 100, partial: Partial<Bar> = {}): Bar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  ...partial,
});

describe('BarFeed', () => {
  const setup = (rest: Bar[] = []) => {
    const delivered: Array<[number, BarSource]> = [];
    const fetches: Array<[number, number]> = [];
    let now = nyEpochAt(DAY, '10:00');
    const feed = new BarFeed({
      ticker: 'QQQ',
      fetchBars: (start, end) => {
        fetches.push([start, end]);
        return Promise.resolve(
          rest.filter((b) => b.time >= start && b.time < end),
        );
      },
      deliver: (b, source) => {
        delivered.push([b.time, source]);
        return Promise.resolve();
      },
      log: silentLog,
      now: () => now,
    });
    return { feed, delivered, fetches, setNow: (t: number) => (now = t) };
  };
  const t = (hhmm: string) => nyEpochAt(DAY, hhmm);

  it('delivers in order, drops repeats and late bars', async () => {
    const { feed, delivered } = setup();
    feed.startAfter(t('09:58'));
    await feed.push(bar(t('09:58')));
    await feed.push(bar(t('09:59')));
    await feed.push(bar(t('09:59')));
    assert.deepEqual(delivered, [[t('09:59'), 'stream']]);
    assert.equal(feed.stats.duplicates, 2);
  });

  it('fills a gap from REST before the bar that revealed it', async () => {
    const { feed, delivered, fetches } = setup([
      bar(t('10:01')),
      bar(t('10:02')),
    ]);
    feed.startAfter(t('10:00'));
    await feed.push(bar(t('10:03')));
    assert.deepEqual(fetches, [[t('10:01'), t('10:03')]]);
    assert.deepEqual(delivered, [
      [t('10:01'), 'backfill'],
      [t('10:02'), 'backfill'],
      [t('10:03'), 'stream'],
    ]);
    assert.equal(feed.stats.backfilled, 2);
  });

  it('catches up to the last closed minute, and an empty gap is fine', async () => {
    const { feed, delivered, setNow } = setup([bar(t('10:05'))]);
    feed.startAfter(t('10:02'));
    setNow(t('10:07') + 20_000);
    assert.equal(await feed.catchUp(), 1);
    assert.deepEqual(delivered, [[t('10:05'), 'backfill']]);
    assert.equal(await feed.catchUp(), 0);
  });
});

describe('planReconcile', () => {
  const saved = (symbol: string, partial: Partial<Position> = {}) => ({
    runId: 'tb-old',
    status: 'open' as const,
    entryRefPrice: 2.5,
    position: {
      id: 'tb-old-261116-p1',
      ticker: 'QQQ',
      direction: 'bullish' as const,
      contract: {
        symbol,
        underlying: 'QQQ',
        type: 'call' as const,
        strike: 600,
        expiration: '2026-11-17',
        bid: 2.4,
        ask: 2.5,
      },
      status: 'open' as const,
      qty: 1,
      entryPrice: 2.5,
      entryTime: nyEpochAt(DAY, '09:36'),
      entryDate: DAY,
      entryBarIndex: 5,
      mark: 2.5,
      peakMark: 2.6,
      atEntry: {
        underlyingPrice: 600,
        indicators: { boxLow: 598, boxHigh: 600 },
      },
      ...partial,
    },
  });
  const order = (clientOrderId: string): BrokerOrder => ({
    id: clientOrderId,
    clientOrderId,
    symbol: 'QQQ261117C00600000',
    side: 'sell',
    type: 'limit',
    qty: 1,
    limitPrice: 2,
    status: 'new',
    filledQty: 0,
    filledAvgPrice: null,
    updatedAt: 0,
  });

  it("restores a saved position at the broker's quantity and price", () => {
    const plan = planReconcile({
      tickers: ['QQQ'],
      clientOrderPrefix: 'tb-',
      brokerPositions: [
        {
          symbol: 'QQQ261117C00600000',
          qty: 2,
          avgEntryPrice: 2.55,
          assetClass: 'us_option',
        },
      ],
      openOrders: [order('tb-old-261116-o3'), order('manual-1')],
      saved: [saved('QQQ261117C00600000')],
    });
    assert.equal(plan.restore.length, 1);
    assert.equal(plan.restore[0]?.qty, 2);
    assert.equal(plan.restore[0]?.entryPrice, 2.55);
    assert.deepEqual(
      plan.cancel.map((o) => o.clientOrderId),
      ['tb-old-261116-o3'],
    );
    assert.equal(plan.foreign.length, 1);
  });

  it('flattens what it cannot explain, leaves other holdings, and notices saved ones gone', () => {
    const plan = planReconcile({
      tickers: ['QQQ'],
      clientOrderPrefix: 'tb-',
      brokerPositions: [
        {
          symbol: 'QQQ261117P00590000',
          qty: 1,
          avgEntryPrice: 1,
          assetClass: 'us_option',
        },
        {
          symbol: 'SPY261117C00660000',
          qty: 1,
          avgEntryPrice: 1,
          assetClass: 'us_option',
        },
        { symbol: 'QQQ', qty: 10, avgEntryPrice: 600, assetClass: 'us_equity' },
        {
          symbol: 'QQQ261117C00610000',
          qty: -1,
          avgEntryPrice: 1,
          assetClass: 'us_option',
        },
      ],
      openOrders: [],
      saved: [saved('QQQ261117C00600000')],
    });
    assert.deepEqual(
      plan.flatten.map((f) => f.symbol),
      ['QQQ261117P00590000'],
    );
    assert.equal(plan.foreign.length, 3);
    assert.equal(plan.gone.length, 1);
    assert.equal(plan.restore.length, 0);
  });

  it('finds an underlying stop that was hit while the bot was down', () => {
    const position = saved('QQQ261117C00600000').position;
    const exits = [
      { type: 'flatBeforeClose' as const, minutes: 5 },
      {
        type: 'underlyingStop' as const,
        indicator: 'boxLow',
        bearishIndicator: 'boxHigh',
      },
    ];
    const bars = [
      bar(nyEpochAt(DAY, '09:40'), 600.5, { low: 599 }),
      bar(nyEpochAt(DAY, '09:41'), 598.2, { low: 597.9 }),
    ];
    assert.equal(
      missedExit(position, bars.slice(0, 1), exits, weekdayCalendar),
      undefined,
    );
    assert.equal(
      missedExit(position, bars, exits, weekdayCalendar)?.reason,
      'underlyingStop',
    );
    assert.equal(
      missedExit(position, bars, exits, weekdayCalendar)?.bar.time,
      nyEpochAt(DAY, '09:41'),
    );
  });
});

describe('checkAccount', () => {
  const account = (partial: Partial<AccountInfo> = {}): AccountInfo => ({
    status: 'ACTIVE',
    equity: 100_000,
    multiplier: 4,
    optionsApprovedLevel: 3,
    optionsTradingLevel: 3,
    patternDayTrader: false,
    daytradeCount: 0,
    tradingBlocked: false,
    accountBlocked: false,
    ...partial,
  });

  it('allows a level 3 account over $25k', () => {
    assert.deepEqual(checkAccount(account()), { blockers: [], warnings: [] });
  });

  it('blocks a margin account under $25k with 3 day trades, and warns before that', () => {
    const small = checkAccount(account({ equity: 20_000, daytradeCount: 2 }));
    assert.equal(small.blockers.length, 0);
    assert.match(small.warnings[0] ?? '', /day trade/);
    const atLimit = checkAccount(account({ equity: 20_000, daytradeCount: 3 }));
    assert.match(atLimit.blockers[0] ?? '', /pattern day trader/);
    assert.equal(
      checkAccount(account({ equity: 20_000, daytradeCount: 3, multiplier: 1 }))
        .blockers.length,
      0,
    );
  });

  it('blocks below options level 2, and a blocked account', () => {
    assert.match(
      checkAccount(account({ optionsApprovedLevel: 1 })).blockers[0] ?? '',
      /level 1/,
    );
    assert.equal(
      checkAccount(account({ tradingBlocked: true })).blockers.length,
      1,
    );
  });

  it('says so when the broker does not report day trading fields', () => {
    const { warnings } = checkAccount(
      account({ patternDayTrader: null, daytradeCount: null }),
    );
    assert.ok(warnings.some((w) => /not reported/.test(w)));
  });
});
