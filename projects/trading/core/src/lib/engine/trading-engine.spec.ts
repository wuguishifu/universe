import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at, DAY, FakeChains, minuteBars } from '../../testing/fixtures';
import { StrategyConfigInput } from '../config/strategy-config';
import { MINUTE_MS } from '../market/ny-time';
import { Bar } from '../market/types';

import { TradingEngine } from './trading-engine';
import { EngineEvent, OrderIntent } from './types';

// With EMA3 against VWAP on these 1-minute closes, the 09:38 bar crosses up and the 09:44 bar crosses down.
const PRICES = [
  100, 99, 98, 97, 96, 95, 96, 98, 100, 102, 104, 103, 100, 97, 94, 92,
];
const OPEN = at(DAY, '09:30');
const BARS = minuteBars(OPEN, PRICES);
const UP_CROSS = 8;
const barAt = (i: number): Bar => {
  const bar = BARS[i];
  assert.ok(bar);
  return bar;
};
const DOWN_CROSS = 14;

const baseConfig = {
  tickers: ['SPY'],
  timeframeMinutes: 1,
  indicators: { ema: { type: 'ema', length: 3 }, vwap: { type: 'vwap' } },
  signal: { type: 'crossover', fast: 'ema', slow: 'vwap' },
  exits: [{ type: 'oppositeSignal' }],
  contract: { expiry: { type: 'nearest', minDte: 1 }, strike: { type: 'atm' } },
  sizing: { type: 'contracts', count: 2 },
} satisfies StrategyConfigInput;

const engineWith = (overrides: Partial<StrategyConfigInput> = {}) => {
  const chains = new FakeChains();
  const engine = new TradingEngine({
    chains,
    config: { ...baseConfig, ...overrides },
  });
  return { engine, chains };
};

async function feed(
  engine: TradingEngine,
  bars: readonly Bar[],
): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for (const bar of bars) events.push(...(await engine.onBar('SPY', bar)));
  return events;
}

const orders = (events: readonly EngineEvent[]): OrderIntent[] =>
  events.flatMap((e) => (e.type === 'order' ? [e.order] : []));

const skips = (events: readonly EngineEvent[]): string[] =>
  events.flatMap((e) => (e.type === 'entrySkipped' ? [e.reason] : []));

function onlyOrder(events: readonly EngineEvent[]): OrderIntent {
  const all = orders(events);
  assert.equal(all.length, 1, `expected one order, got ${JSON.stringify(all)}`);
  const [order] = all;
  assert.ok(order);
  return order;
}

const fill = (
  engine: TradingEngine,
  order: OrderIntent,
  price: number,
  time = order.time,
) =>
  engine.onOrderUpdate({
    orderId: order.id,
    status: 'filled',
    filledQty: order.qty,
    avgFillPrice: price,
    time,
  });

/** Feeds up to and including the up-cross, then fills the entry at 1.00. */
async function enterLong(engine: TradingEngine): Promise<OrderIntent> {
  const entry = onlyOrder(await feed(engine, BARS.slice(0, UP_CROSS + 1)));
  await fill(engine, entry, 1);
  return entry;
}

describe('TradingEngine', () => {
  it('buys the at-the-money call for the next expiry on a bullish cross', async () => {
    const { engine, chains } = engineWith();
    const events = await feed(engine, BARS.slice(0, UP_CROSS + 1));

    assert.deepEqual(
      events.flatMap((e) => (e.type === 'signal' ? [e.direction] : [])),
      ['bullish'],
    );
    const order = onlyOrder(events);
    assert.equal(order.action, 'open');
    assert.equal(order.side, 'buy');
    assert.equal(order.symbol, 'SPY-2026-11-17-call-100');
    assert.equal(order.qty, 2);
    assert.equal(order.refPrice, 1.04);
    // The decision is made when the 09:38 bar closes, at 09:39.
    assert.equal(order.time, at(DAY, '09:39'));
    assert.deepEqual(chains.requests[0], {
      underlying: 'SPY',
      type: 'call',
      time: at(DAY, '09:39'),
      underlyingPrice: 100,
    });
  });

  it('opens the position at the fill price and stops out at -30% of premium', async () => {
    const { engine } = engineWith({ exits: [{ type: 'pnlStop', pct: 0.3 }] });
    const entry = onlyOrder(await feed(engine, BARS.slice(0, UP_CROSS + 1)));

    const opened = await fill(engine, entry, 1.02);
    assert.equal(opened[0]?.type, 'positionOpened');
    assert.equal(engine.getPositions()[0]?.entryPrice, 1.02);

    const symbol = entry.symbol;
    const time = at(DAY, '09:40');
    // mid 0.72 is -29.4%
    assert.deepEqual(
      await engine.onQuote({ symbol, time, bid: 0.71, ask: 0.73 }),
      [],
    );
    // mid 0.71 is -30.4%
    const exit = onlyOrder(
      await engine.onQuote({ symbol, time, bid: 0.7, ask: 0.72 }),
    );
    assert.equal(exit.action, 'close');
    assert.equal(exit.side, 'sell');
    assert.equal(exit.reason, 'pnlStop');
    assert.equal(exit.qty, 2);
    assert.equal(exit.refPrice, 0.7);

    const closed = await fill(engine, exit, 0.7, time + 1_000);
    assert.equal(closed[0]?.type, 'positionClosed');
    const [trade] = engine.getTrades();
    assert.equal(trade?.reason, 'pnlStop');
    assert.equal(trade?.pnl.toFixed(2), '-64.00'); // (0.70 - 1.02) × 2 × 100
    assert.deepEqual(engine.getPositions(), []);
  });

  it('closes on the opposite cross and opens the other way on the same bar', async () => {
    const { engine } = engineWith();
    await enterLong(engine);
    const events = await feed(engine, BARS.slice(UP_CROSS + 1, DOWN_CROSS + 1));

    const [close, open] = orders(events);
    assert.equal(close?.action, 'close');
    assert.equal(close?.reason, 'oppositeSignal');
    assert.equal(open?.action, 'open');
    assert.equal(open?.symbol, 'SPY-2026-11-17-put-94');
  });

  it('exits when a bar closes back through the indicator', async () => {
    const { engine } = engineWith({
      exits: [{ type: 'indicatorBreak', indicator: 'ema', trigger: 'close' }],
    });
    await enterLong(engine);
    const events = await feed(engine, BARS.slice(UP_CROSS + 1, DOWN_CROSS));

    const exit = onlyOrder(events);
    assert.equal(exit.reason, 'indicatorBreak');
    // 09:42 closes at 100, below EMA3's 101.28.
    assert.equal(exit.time, at(DAY, '09:43'));
  });

  it('goes flat before the close on time alone', async () => {
    const { engine } = engineWith({
      exits: [{ type: 'flatBeforeClose', minutes: 10 }],
    });
    await enterLong(engine);

    assert.deepEqual(
      orders(await feed(engine, minuteBars(at(DAY, '15:48'), [100]))),
      [],
    );
    const exit = onlyOrder(
      await feed(engine, minuteBars(at(DAY, '15:49'), [100])),
    );
    assert.equal(exit.reason, 'flatBeforeClose');
  });

  it('holds off entries until the start delay has passed', async () => {
    // Signals are decided at 09:39 (up) and 09:45 (down). A 10-minute delay only blocks the first.
    const { engine } = engineWith({
      entryFilters: [{ type: 'timeWindow', startDelayMinutes: 10 }],
    });
    const events = await feed(engine, BARS);
    assert.deepEqual(skips(events), ['blocked by timeWindow']);
    assert.equal(onlyOrder(events).symbol, 'SPY-2026-11-17-put-94');

    const { engine: later } = engineWith({
      entryFilters: [{ type: 'timeWindow', startDelayMinutes: 9 }],
    });
    assert.equal(
      onlyOrder(await feed(later, BARS)).symbol,
      'SPY-2026-11-17-call-100',
    );
  });

  it('cools down after a stop-out', async () => {
    const { engine } = engineWith({
      exits: [{ type: 'pnlStop', pct: 0.3 }],
      entryFilters: [{ type: 'cooldown', bars: 10, afterReasons: ['pnlStop'] }],
    });
    const entry = await enterLong(engine);
    const exit = onlyOrder(
      await engine.onQuote({
        symbol: entry.symbol,
        time: at(DAY, '09:40'),
        bid: 0.5,
        ask: 0.5,
      }),
    );
    await fill(engine, exit, 0.5);

    const events = await feed(engine, BARS.slice(UP_CROSS + 1));
    assert.deepEqual(skips(events), ['blocked by cooldown']);
  });

  it('forgets an entry the broker rejected', async () => {
    const { engine } = engineWith();
    const entry = onlyOrder(await feed(engine, BARS.slice(0, UP_CROSS + 1)));
    const events = await engine.onOrderUpdate({
      orderId: entry.id,
      status: 'rejected',
      filledQty: 0,
      avgFillPrice: 0,
      time: entry.time,
    });
    assert.equal(events[0]?.type, 'entryFailed');
    assert.deepEqual(engine.getPositions(), []);

    // Free to take the next signal.
    const next = onlyOrder(await feed(engine, BARS.slice(UP_CROSS + 1)));
    assert.equal(next.symbol, 'SPY-2026-11-17-put-94');
  });

  it('reopens a position whose exit order was canceled, keeping what did not sell', async () => {
    const { engine } = engineWith({ exits: [{ type: 'pnlStop', pct: 0.3 }] });
    const entry = await enterLong(engine);
    const time = at(DAY, '09:40');
    const exit = onlyOrder(
      await engine.onQuote({ symbol: entry.symbol, time, bid: 0.6, ask: 0.6 }),
    );

    const events = await engine.onOrderUpdate({
      orderId: exit.id,
      status: 'canceled',
      filledQty: 1,
      avgFillPrice: 0.6,
      time,
    });
    assert.equal(events[0]?.type, 'exitFailed');
    assert.equal(engine.getPositions()[0]?.qty, 1);
    assert.equal(engine.getPositions()[0]?.status, 'open');
    assert.equal(engine.getTrades()[0]?.qty, 1);

    // The stop fires again for the contract that's left.
    const retry = onlyOrder(
      await engine.onQuote({ symbol: entry.symbol, time, bid: 0.6, ask: 0.6 }),
    );
    assert.equal(retry.qty, 1);
  });

  it('warms up without trading, then trades on the next live cross', async () => {
    const { engine } = engineWith();
    await engine.warmup('SPY', BARS.slice(0, UP_CROSS));
    const events = await engine.onBar('SPY', barAt(UP_CROSS));
    assert.equal(onlyOrder(events).action, 'open');
  });

  it('ignores pre-market bars for the regular session', async () => {
    const { engine } = engineWith();
    const premarket = minuteBars(at(DAY, '09:00'), [50, 60, 70]);
    const events = await feed(engine, premarket);
    assert.deepEqual(events, []);
    // VWAP still starts fresh at the open.
    const [first] = await feed(engine, BARS.slice(0, 1));
    assert.ok(first?.type === 'bar');
    assert.equal(first.snapshot.indicators['vwap'], 100);
  });

  it('rolls 1-minute bars into the configured timeframe', async () => {
    const { engine } = engineWith({ timeframeMinutes: 5 });
    const events = await feed(engine, minuteBars(OPEN, [1, 2, 3, 4, 5, 6]));
    const bars = events.flatMap((e) =>
      e.type === 'bar' ? [e.snapshot.bar] : [],
    );
    assert.deepEqual(bars, [
      { time: OPEN, open: 1, high: 5, low: 1, close: 5, volume: 5_000 },
    ]);
  });

  it('needs equity before sizing by percentage', async () => {
    const { engine } = engineWith({ sizing: { type: 'pctEquity', pct: 0.1 } });
    const events = await feed(engine, BARS.slice(0, UP_CROSS + 1));
    assert.deepEqual(skips(events), ['sizing needs equity; call setEquity']);

    const { engine: funded } = engineWith({
      sizing: { type: 'pctEquity', pct: 0.1 },
    });
    funded.setEquity(2_500); // $250 buys two contracts at 1.04
    assert.equal(
      onlyOrder(await feed(funded, BARS.slice(0, UP_CROSS + 1))).qty,
      2,
    );
  });

  it('processes overlapping calls in the order they were made', async () => {
    const { engine } = engineWith();
    const results = await Promise.all(
      BARS.map((bar) => engine.onBar('SPY', bar)),
    );
    const signals = results
      .flat()
      .flatMap((e) => (e.type === 'signal' ? [e.time] : []));
    assert.deepEqual(signals, [
      OPEN + (UP_CROSS + 1) * MINUTE_MS,
      OPEN + (DOWN_CROSS + 1) * MINUTE_MS,
    ]);
  });

  it('rejects bars for tickers it was not configured with', async () => {
    const { engine } = engineWith();
    await assert.rejects(
      engine.onBar('QQQ', barAt(0)),
      /QQQ is not in this strategy's tickers/,
    );
  });
});
