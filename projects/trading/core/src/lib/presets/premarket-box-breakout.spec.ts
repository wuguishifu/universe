import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  at,
  bar,
  DAY,
  FakeChains,
  NEXT_DAY,
  position,
} from '../../testing/fixtures';
import {
  parseStrategyConfig,
  StrategyConfigInput,
} from '../config/strategy-config';
import { TradingEngine } from '../engine/trading-engine';
import { EngineEvent, OrderIntent } from '../engine/types';
import { UnderlyingStop, UnderlyingTarget } from '../exits/rules';
import { TimeWindow } from '../filters/filters';
import { createIndicator } from '../indicators/config';
import { TimeRange } from '../indicators/session-levels';
import { BarAggregator } from '../market/bar-aggregator';
import { REGULAR_HOURS } from '../market/calendar';
import { MINUTE_MS, nyTime } from '../market/ny-time';
import { Bar } from '../market/types';
import { Clock } from '../strategy/types';

import { PREMARKET_BOX_BREAKOUT } from './premarket-box-breakout';

const clockAt = (time: number): Clock => ({
  time,
  ...nyTime(time),
  hours: REGULAR_HOURS,
});
const minuteEvent = (time: number, partial: Partial<Bar>) => ({
  kind: 'clock' as const,
  clock: clockAt(time + MINUTE_MS),
  bar: bar(time, partial.close ?? 100, partial),
});

describe('TimeRange', () => {
  it('holds the 09:00–09:30 high and low from 09:30 for the rest of the session', () => {
    const high = new TimeRange({
      type: 'timeRange',
      side: 'high',
      start: '09:00',
      end: '09:30',
    });
    const low = new TimeRange({
      type: 'timeRange',
      side: 'low',
      start: '09:00',
      end: '09:30',
    });
    const bars = [
      bar(at(DAY, '08:55'), 120, { high: 125, low: 80 }), // before the window
      bar(at(DAY, '09:00'), 100, { high: 101, low: 99 }),
      bar(at(DAY, '09:25'), 100, { high: 102, low: 98 }),
      bar(at(DAY, '09:30'), 110, { high: 111, low: 97 }), // after: doesn't widen it
      bar(at(DAY, '10:00'), 90, { high: 91, low: 89 }),
    ];
    assert.deepEqual(
      bars.map((b) => high.update(b)),
      [undefined, undefined, undefined, 102, 102],
    );
    assert.deepEqual(
      bars.map((b) => low.update(b)),
      [undefined, undefined, undefined, 98, 98],
    );
    high.startSession();
    assert.equal(high.value, undefined);
  });

  it('stays undefined on a day with no bars in the window', () => {
    const high = new TimeRange({
      type: 'timeRange',
      side: 'high',
      start: '09:00',
      end: '09:30',
    });
    assert.equal(high.update(bar(at(DAY, '09:35'), 100)), undefined);
  });

  it('needs the extended session when the window starts before the open', () => {
    assert.throws(
      () =>
        parseStrategyConfig({ ...PREMARKET_BOX_BREAKOUT, session: 'regular' }),
      /needs session: 'extended'/,
    );
  });
});

describe('BarAggregator with longer input bars', () => {
  it('rolls 5-minute bars into 15-minute ones, emitting on the last of the three', () => {
    const aggregator = new BarAggregator(15, 5);
    const start = at(DAY, '09:30');
    assert.deepEqual(aggregator.push(bar(start, 1, { high: 3 })), []);
    assert.deepEqual(aggregator.push(bar(start + 5 * MINUTE_MS, 2)), []);
    const done = aggregator.push(bar(start + 10 * MINUTE_MS, 4, { low: 0.5 }));
    assert.equal(done.length, 1);
    assert.deepEqual(
      { ...done[0], volume: undefined },
      { time: start, open: 1, high: 4, low: 0.5, close: 4, volume: undefined },
    );
  });

  it('rejects input bars that do not divide the timeframe', () => {
    assert.throws(() => new BarAggregator(15, 10), /don't divide/);
  });
});

describe('EMA on a longer timeframe', () => {
  it('matches an EMA fed the 15-minute closes directly', () => {
    const ema = {
      type: 'ema',
      length: 2,
      source: 'close',
      warmup: 'carryOver',
    } as const;
    const resampled = createIndicator({ ...ema, timeframeMinutes: 15 }, 5);
    const direct = createIndicator(ema);
    const start = at(DAY, '09:30');
    const closes = [1, 2, 3, 6, 5, 4, 10, 11, 12];
    let expected: number | undefined;
    closes.forEach((close, i) => {
      const value = resampled.update(bar(start + i * 5 * MINUTE_MS, close));
      if (i % 3 === 2)
        expected = direct.update(bar(start + (i - 2) * 5 * MINUTE_MS, close));
      assert.equal(value, expected, `after 5-minute bar ${i}`);
    });
    assert.equal(expected, ((3 + 4) / 2) * (1 / 3) + 12 * (2 / 3));
  });

  it('must be a multiple of the strategy timeframe', () => {
    assert.throws(
      () =>
        parseStrategyConfig({
          ...PREMARKET_BOX_BREAKOUT,
          indicators: {
            ...PREMARKET_BOX_BREAKOUT.indicators,
            ema50: { type: 'ema', length: 50, timeframeMinutes: 6 },
          },
        }),
      /multiple of the strategy's 5/,
    );
  });
});

describe('TimeWindow latestAfterOpenMinutes', () => {
  const filter = new TimeWindow({
    type: 'timeWindow',
    startDelayMinutes: 0,
    endBeforeCloseMinutes: 0,
    latestAfterOpenMinutes: 60,
  });
  const allow = (hhmm: string) =>
    filter.allow({
      ticker: 'QQQ',
      direction: 'bullish',
      clock: clockAt(at(DAY, hhmm)),
      barIndex: 0,
      entriesToday: 0,
      indicators: {},
    });

  it('allows a signal from the bar closing at 10:30, not later', () => {
    assert.equal(allow('09:35'), true);
    assert.equal(allow('10:30'), true);
    assert.equal(allow('10:35'), false);
  });
});

describe('UnderlyingStop and UnderlyingTarget', () => {
  const stop = new UnderlyingStop({
    type: 'underlyingStop',
    indicator: 'boxLow',
    bearishIndicator: 'boxHigh',
  });
  const target = new UnderlyingTarget({
    type: 'underlyingTarget',
    stopIndicator: 'boxLow',
    bearishStopIndicator: 'boxHigh',
    rMultiple: 3,
  });
  const atEntry = {
    underlyingPrice: 102,
    indicators: { boxLow: 99, boxHigh: 101 },
  };
  const long = position({ atEntry });
  const short = position({
    direction: 'bearish',
    atEntry: { underlyingPrice: 98, indicators: { boxLow: 99, boxHigh: 101 } },
  });
  const t = at(DAY, '10:00');

  it('stops a call when a minute bar trades at or below the box low', () => {
    assert.equal(stop.shouldExit(long, minuteEvent(t, { low: 99.01 })), false);
    assert.equal(stop.shouldExit(long, minuteEvent(t, { low: 99 })), true);
  });

  it('stops a put at the box high', () => {
    assert.equal(
      stop.shouldExit(short, minuteEvent(t, { high: 100.99 })),
      false,
    );
    assert.equal(stop.shouldExit(short, minuteEvent(t, { high: 101 })), true);
  });

  it('takes profit at 3R from the entry price: 111 for the call, 89 for the put', () => {
    assert.equal(
      target.shouldExit(long, minuteEvent(t, { high: 110.99 })),
      false,
    );
    assert.equal(target.shouldExit(long, minuteEvent(t, { high: 111 })), true);
    assert.equal(
      target.shouldExit(short, minuteEvent(t, { low: 89.01 })),
      false,
    );
    assert.equal(target.shouldExit(short, minuteEvent(t, { low: 89 })), true);
  });

  it('ignores bar and mark events, and positions without entry levels', () => {
    assert.equal(
      stop.shouldExit(long, { kind: 'mark', clock: clockAt(t) }),
      false,
    );
    assert.equal(
      stop.shouldExit(position(), minuteEvent(t, { low: 0 })),
      false,
    );
    assert.equal(
      target.shouldExit(position(), minuteEvent(t, { high: 1e9 })),
      false,
    );
  });
});

// --- the preset, end to end ---------------------------------------------------------------------

/** Short EMAs so a few warmup bars settle the trend filter. */
const testConfig = (
  overrides: Partial<StrategyConfigInput> = {},
): StrategyConfigInput => ({
  ...PREMARKET_BOX_BREAKOUT,
  indicators: {
    ...PREMARKET_BOX_BREAKOUT.indicators,
    ema50: { type: 'ema', length: 2, timeframeMinutes: 15 },
    ema200: { type: 'ema', length: 4, timeframeMinutes: 15 },
  },
  ...overrides,
});

/** One flat 1-minute bar per minute from `start`. */
const flatBars = (
  start: number,
  count: number,
  close: number,
  partial: Partial<Bar> = {},
): Bar[] =>
  Array.from({ length: count }, (_, i) =>
    bar(start + i * MINUTE_MS, close, partial),
  );

/** The previous session rising from 90 to 99.5: the 15-minute EMA50 ends above the EMA200. */
const uptrend = (): Bar[] =>
  Array.from({ length: 120 }, (_, i) =>
    bar(at('2026-11-13', '09:30') + i * MINUTE_MS, 90 + (9.5 * i) / 119),
  );

/** 09:00–09:29 inside a 99–101 box. */
const box = (): Bar[] =>
  flatBars(at(DAY, '09:00'), 30, 100, { high: 101, low: 99 });

async function run(
  engine: TradingEngine,
  bars: readonly Bar[],
): Promise<EngineEvent[]> {
  const events: EngineEvent[] = [];
  for (const b of bars) events.push(...(await engine.onBar('QQQ', b)));
  return events;
}
const ordersIn = (events: readonly EngineEvent[]): OrderIntent[] =>
  events.flatMap((e) => (e.type === 'order' ? [e.order] : []));

async function setup(overrides: Partial<StrategyConfigInput> = {}) {
  const engine = new TradingEngine({
    chains: new FakeChains(),
    config: testConfig(overrides),
  });
  await engine.warmup('QQQ', uptrend());
  await run(engine, box());
  return engine;
}

describe('PREMARKET_BOX_BREAKOUT', () => {
  it('parses', () => {
    assert.doesNotThrow(() => parseStrategyConfig(PREMARKET_BOX_BREAKOUT));
  });

  it('buys the next expiration ATM call when a 5-minute bar closes above the box, then stops out at the box low', async () => {
    const engine = await setup();
    // 09:30–09:34: the 5-minute bar closes at 102, above the box high of 101.
    const entry = ordersIn(
      await run(engine, flatBars(at(DAY, '09:30'), 5, 102)),
    );
    assert.equal(entry.length, 1);
    assert.equal(entry[0]?.symbol, `QQQ-${NEXT_DAY}-call-102`);
    assert.equal(entry[0]?.time, at(DAY, '09:35'));
    const [order] = entry;
    assert.ok(order);
    await engine.onOrderUpdate({
      orderId: order.id,
      status: 'filled',
      filledQty: 1,
      avgFillPrice: 1.04,
      time: order.time,
    });

    assert.deepEqual(
      ordersIn(
        await run(engine, flatBars(at(DAY, '09:35'), 10, 100, { low: 99.5 })),
      ),
      [],
    );
    const exit = ordersIn(
      await run(engine, [bar(at(DAY, '09:45'), 99.5, { low: 98.9 })]),
    );
    assert.equal(exit.length, 1);
    assert.equal(exit[0]?.reason, 'underlyingStop');
    assert.equal(exit[0]?.time, at(DAY, '09:46'));
  });

  it('takes profit at 3R: 102 + 3 × (102 − 99) = 111', async () => {
    const engine = await setup();
    const [order] = ordersIn(
      await run(engine, flatBars(at(DAY, '09:30'), 5, 102)),
    );
    assert.ok(order);
    await engine.onOrderUpdate({
      orderId: order.id,
      status: 'filled',
      filledQty: 1,
      avgFillPrice: 1.04,
      time: order.time,
    });
    assert.deepEqual(
      ordersIn(
        await run(engine, [bar(at(DAY, '10:00'), 110, { high: 110.9 })]),
      ),
      [],
    );
    const exit = ordersIn(
      await run(engine, [bar(at(DAY, '10:01'), 110, { high: 111 })]),
    );
    assert.equal(exit[0]?.reason, 'underlyingTarget');
  });

  it('skips the day when the first breakout goes against the trend, even if a later one agrees', async () => {
    const engine = await setup();
    const down = await run(engine, flatBars(at(DAY, '09:30'), 5, 98));
    assert.deepEqual(ordersIn(down), []);
    assert.ok(
      down.some(
        (e) =>
          e.type === 'entrySkipped' && e.reason === 'blocked by indicatorSide',
      ),
    );
    const up = await run(engine, flatBars(at(DAY, '09:35'), 10, 102));
    assert.deepEqual(ordersIn(up), []);
    assert.ok(
      !up.some((e) => e.type === 'signal'),
      'only the first breakout of the day signals',
    );
  });

  it('does not enter on a first breakout after 10:30', async () => {
    const engine = await setup();
    await run(engine, flatBars(at(DAY, '09:30'), 65, 100));
    const late = await run(engine, flatBars(at(DAY, '10:35'), 5, 102));
    assert.deepEqual(ordersIn(late), []);
    assert.ok(
      late.some(
        (e) =>
          e.type === 'entrySkipped' && e.reason === 'blocked by timeWindow',
      ),
    );
  });
});
