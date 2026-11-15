import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at, bar, DAY } from '../../testing/fixtures';
import { REGULAR_HOURS } from '../market/calendar';
import { MINUTE_MS, nyTime } from '../market/ny-time';
import { Clock, Direction } from '../strategy/types';

import { Breakout } from './breakout';
import { TimedMomentum } from './timed-momentum';

const OPEN = at(DAY, '09:30');

describe('Breakout', () => {
  const run = (
    closes: number[],
    signal = new Breakout({
      type: 'breakout',
      upper: 'up',
      lower: 'down',
      source: 'close',
      whileOutside: false,
    }),
  ): Array<Direction | null> =>
    closes.map((close) => signal.update({ up: 10, down: 5 }, bar(OPEN, close)));

  it('fires when price leaves the band, and again only after it returns or flips', () => {
    assert.deepEqual(run([7, 11, 12, 8, 11, 4, 3, 12]), [
      null,
      'bullish',
      null,
      null,
      'bullish',
      'bearish',
      null,
      'bullish',
    ]);
  });

  it('counts a session that opens outside the band', () => {
    assert.deepEqual(run([11]), ['bullish']);
  });

  it('stops after maxPerSession, until the next session', () => {
    const signal = new Breakout({
      type: 'breakout',
      upper: 'up',
      lower: 'down',
      source: 'close',
      maxPerSession: 1,
      whileOutside: false,
    });
    assert.deepEqual(run([11, 7, 4], signal), ['bullish', null, null]);
    signal.startSession();
    assert.deepEqual(run([4], signal), ['bearish']);
  });

  it('can signal on every bar outside the band', () => {
    const signal = new Breakout({
      type: 'breakout',
      upper: 'up',
      lower: 'down',
      source: 'close',
      whileOutside: true,
    });
    assert.deepEqual(run([11, 12, 7, 4], signal), [
      'bullish',
      'bullish',
      null,
      'bearish',
    ]);
  });

  it('waits for both edges', () => {
    const signal = new Breakout({
      type: 'breakout',
      upper: 'up',
      lower: 'down',
      source: 'close',
      whileOutside: false,
    });
    assert.equal(signal.update({ up: 10 }, bar(OPEN, 11)), null);
  });
});

describe('TimedMomentum', () => {
  const clockAt = (time: number): Clock => ({
    time,
    ...nyTime(time),
    hours: REGULAR_HOURS,
  });

  /** Feeds 30-minute bars for one session, closing at `closes`, and returns each bar's signal. */
  const session = (signal: TimedMomentum, closes: number[], day = 0) => {
    signal.startSession();
    return closes.map((close, i) => {
      const start = OPEN + day * 86_400_000 + i * 30 * MINUTE_MS;
      return signal.update(
        {},
        bar(start, close, { open: i === 0 ? 100 : close }),
        clockAt(start + 30 * MINUTE_MS),
      );
    });
  };

  const config = {
    type: 'timedMomentum',
    reference: 'previousClose',
    measureMinutes: 30,
    entryBeforeCloseMinutes: 30,
    minMovePct: 0,
    invert: false,
  } as const;

  it('signals once, on the last half-hour bar, the way the first half hour moved', () => {
    const signal = new TimedMomentum(config);
    const flat = Array.from({ length: 13 }, () => 100);
    session(signal, flat);
    // The 09:30 bar closes up from yesterday's 100, so the 15:00 bar (closing 15:30) signals.
    const signals = session(signal, [101, ...flat.slice(1)], 1);
    assert.equal(signals.filter((s) => s !== null).length, 1);
    assert.equal(signals[11], 'bullish');
  });

  it('skips small moves and can trade against the move', () => {
    const flat = Array.from({ length: 13 }, () => 100);
    const small = new TimedMomentum({ ...config, minMovePct: 0.02 });
    session(small, flat);
    assert.ok(session(small, [101, ...flat.slice(1)], 1).every((s) => !s));

    const fade = new TimedMomentum({ ...config, invert: true });
    session(fade, flat);
    assert.equal(session(fade, [101, ...flat.slice(1)], 1)[11], 'bearish');
  });

  it('needs a previous session before it can signal', () => {
    const signal = new TimedMomentum(config);
    const flat = Array.from({ length: 13 }, () => 100);
    assert.ok(session(signal, [101, ...flat.slice(1)]).every((s) => !s));
  });
});
