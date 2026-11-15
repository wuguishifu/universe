import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at, bar, DAY, NEXT_DAY, position } from '../../testing/fixtures';
import { EntryContext } from '../filters/entry-filter';
import { IndicatorSide } from '../filters/filters';
import { REGULAR_HOURS } from '../market/calendar';
import { nyTime } from '../market/ny-time';
import { Clock, Direction, IndicatorValues } from '../strategy/types';

import { ExitEvent } from './exit-rule';
import {
  FlatBeforeClose,
  IndicatorBreak,
  OppositeSignal,
  PnlStop,
  ProfitTarget,
  TrailingStop,
} from './rules';

const clock = (date: string, hhmm: string): Clock => {
  const time = at(date, hhmm);
  return { time, ...nyTime(time), hours: REGULAR_HOURS };
};
const now = clock(DAY, '11:00');
const mark: ExitEvent = { kind: 'mark', clock: now };
const barEvent = (
  close: number,
  options: {
    index?: number;
    indicators?: IndicatorValues;
    signal?: Direction | null;
    low?: number;
    high?: number;
  } = {},
): ExitEvent => ({
  kind: 'bar',
  clock: now,
  snapshot: {
    bar: bar(now.time, close, {
      low: options.low ?? close,
      high: options.high ?? close,
    }),
    index: options.index ?? 11,
    indicators: options.indicators ?? { ema9: 100 },
    signal: options.signal ?? null,
  },
});

describe('PnlStop', () => {
  const rule = new PnlStop({ type: 'pnlStop', pct: 0.3 });

  it('exits once the premium is down 30%, for calls and puts alike', () => {
    assert.equal(rule.shouldExit(position({ mark: 0.71 }), mark), false);
    assert.equal(rule.shouldExit(position({ mark: 0.7 }), mark), true);
    assert.equal(
      rule.shouldExit(position({ direction: 'bearish', mark: 0.7 }), mark),
      true,
    );
  });

  it('does not exit when a put premium rises', () => {
    assert.equal(
      rule.shouldExit(position({ direction: 'bearish', mark: 1.3 }), mark),
      false,
    );
  });

  it('only looks at mark events', () => {
    assert.equal(
      rule.shouldExit(position({ mark: 0.5 }), { kind: 'clock', clock: now }),
      false,
    );
  });
});

describe('ProfitTarget', () => {
  it('exits at the target gain', () => {
    const rule = new ProfitTarget({ type: 'profitTarget', pct: 0.5 });
    assert.equal(rule.shouldExit(position({ mark: 1.49 }), mark), false);
    assert.equal(rule.shouldExit(position({ mark: 1.5 }), mark), true);
  });
});

describe('TrailingStop', () => {
  it('exits on a pullback from the peak', () => {
    const rule = new TrailingStop({
      type: 'trailingStop',
      pct: 0.2,
      activateAtPct: 0,
    });
    assert.equal(
      rule.shouldExit(position({ peakMark: 2, mark: 1.61 }), mark),
      false,
    );
    assert.equal(
      rule.shouldExit(position({ peakMark: 2, mark: 1.6 }), mark),
      true,
    );
  });

  it('waits for the activation gain', () => {
    const rule = new TrailingStop({
      type: 'trailingStop',
      pct: 0.1,
      activateAtPct: 0.25,
    });
    assert.equal(
      rule.shouldExit(position({ peakMark: 1.2, mark: 1 }), mark),
      false,
    );
    assert.equal(
      rule.shouldExit(position({ peakMark: 1.3, mark: 1.1 }), mark),
      true,
    );
  });
});

describe('IndicatorBreak', () => {
  const close = new IndicatorBreak({
    type: 'indicatorBreak',
    indicator: 'ema9',
    trigger: 'close',
  });
  const wick = new IndicatorBreak({
    type: 'indicatorBreak',
    indicator: 'ema9',
    trigger: 'wick',
  });

  it('exits a call when a bar closes below the indicator', () => {
    assert.equal(
      close.shouldExit(position(), barEvent(100.5, { low: 99 })),
      false,
    );
    assert.equal(close.shouldExit(position(), barEvent(99.5)), true);
  });

  it('exits a put when a bar closes above the indicator', () => {
    const put = position({ direction: 'bearish' });
    assert.equal(close.shouldExit(put, barEvent(99.5)), false);
    assert.equal(close.shouldExit(put, barEvent(100.5)), true);
  });

  it('can trigger on the wick instead', () => {
    assert.equal(
      wick.shouldExit(position(), barEvent(100.5, { low: 99 })),
      true,
    );
    assert.equal(
      wick.shouldExit(
        position({ direction: 'bearish' }),
        barEvent(99.5, { high: 101 }),
      ),
      true,
    );
  });

  it('skips the entry bar', () => {
    assert.equal(
      close.shouldExit(position({ entryBarIndex: 11 }), barEvent(90)),
      false,
    );
  });

  it('checks puts against bearishIndicator when given', () => {
    const band = new IndicatorBreak({
      type: 'indicatorBreak',
      indicator: 'upper',
      bearishIndicator: 'lower',
      trigger: 'close',
    });
    const indicators = { upper: 105, lower: 95 };
    const put = position({ direction: 'bearish' });
    assert.equal(band.shouldExit(put, barEvent(94, { indicators })), false);
    assert.equal(band.shouldExit(put, barEvent(96, { indicators })), true);
    assert.equal(
      band.shouldExit(position(), barEvent(104, { indicators })),
      true,
    );
  });
});

describe('IndicatorSide', () => {
  const filter = new IndicatorSide({
    type: 'indicatorSide',
    fast: 'price',
    slow: 'vwap',
  });
  const context = (
    direction: Direction,
    indicators: IndicatorValues,
  ): EntryContext => ({
    ticker: 'SPY',
    direction,
    clock: now,
    barIndex: 11,
    entriesToday: 0,
    indicators,
  });

  it('lets calls through above and puts below, and nothing while warming up', () => {
    const above = { price: 101, vwap: 100 };
    assert.equal(filter.allow(context('bullish', above)), true);
    assert.equal(filter.allow(context('bearish', above)), false);
    assert.equal(
      filter.allow(context('bearish', { price: 99, vwap: 100 })),
      true,
    );
    assert.equal(filter.allow(context('bullish', { price: 101 })), false);
  });
});

describe('OppositeSignal', () => {
  it('exits only on a signal the other way', () => {
    const rule = new OppositeSignal();
    assert.equal(
      rule.shouldExit(position(), barEvent(100, { signal: 'bullish' })),
      false,
    );
    assert.equal(
      rule.shouldExit(position(), barEvent(100, { signal: 'bearish' })),
      true,
    );
  });
});

describe('FlatBeforeClose', () => {
  const rule = new FlatBeforeClose({ type: 'flatBeforeClose', minutes: 10 });

  it('exits from ten minutes before the close', () => {
    assert.equal(
      rule.shouldExit(position(), {
        kind: 'clock',
        clock: clock(DAY, '15:49'),
      }),
      false,
    );
    assert.equal(
      rule.shouldExit(position(), { kind: 'mark', clock: clock(DAY, '15:50') }),
      true,
    );
  });

  it('exits anything left over from an earlier day', () => {
    assert.equal(
      rule.shouldExit(position(), {
        kind: 'clock',
        clock: clock(NEXT_DAY, '09:31'),
      }),
      true,
    );
  });
});
