import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at, bar, DAY, minuteBars } from '../../testing/fixtures';

import { BarAggregator } from './bar-aggregator';
import { calendarFromDays, REGULAR_HOURS, weekdayCalendar } from './calendar';
import { daysBetween, MINUTE_MS, nyTime } from './ny-time';

describe('nyTime', () => {
  it('converts standard time', () => {
    assert.deepEqual(nyTime(Date.parse('2026-11-16T14:30:00Z')), {
      date: '2026-11-16',
      minute: 570,
    });
  });

  it('converts daylight time, keeping seconds as a fraction', () => {
    assert.deepEqual(nyTime(Date.parse('2026-07-01T13:30:30Z')), {
      date: '2026-07-01',
      minute: 570.5,
    });
  });

  it('uses the New York date late in the evening', () => {
    assert.deepEqual(nyTime(Date.parse('2026-11-17T03:00:00Z')), {
      date: '2026-11-16',
      minute: 22 * 60,
    });
  });

  it('follows the spring-forward jump', () => {
    assert.equal(nyTime(Date.parse('2026-03-08T06:30:00Z')).minute, 90); // 01:30 EST
    assert.equal(nyTime(Date.parse('2026-03-08T07:30:00Z')).minute, 210); // 03:30 EDT
  });
});

describe('daysBetween', () => {
  it('counts calendar days', () => {
    assert.equal(daysBetween('2026-11-16', '2026-11-20'), 4);
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
    assert.equal(daysBetween('2026-11-16', '2026-11-16'), 0);
  });
});

describe('calendars', () => {
  it('weekdayCalendar closes weekends', () => {
    assert.deepEqual(weekdayCalendar.regularHours('2026-11-16'), REGULAR_HOURS);
    assert.equal(weekdayCalendar.regularHours('2026-11-14'), null);
  });

  it('calendarFromDays reads early closes and treats missing days as closed', () => {
    const calendar = calendarFromDays([
      { date: '2026-11-27', open: '09:30', close: '13:00' },
    ]);
    assert.deepEqual(calendar.regularHours('2026-11-27'), {
      open: 570,
      close: 780,
    });
    assert.equal(calendar.regularHours('2026-11-26'), null);
  });
});

describe('BarAggregator', () => {
  it('rolls five minutes into one bar when the last minute arrives', () => {
    const aggregator = new BarAggregator(5);
    const start = at(DAY, '09:30');
    const bars = [
      bar(start, 10, { open: 9, high: 11, low: 9, volume: 1 }),
      bar(start + MINUTE_MS, 12, { high: 13, low: 8, volume: 2 }),
      bar(start + 2 * MINUTE_MS, 11, { volume: 3 }),
      bar(start + 3 * MINUTE_MS, 10, { volume: 4 }),
    ];
    for (const b of bars) assert.deepEqual(aggregator.push(b), []);

    const done = aggregator.push(
      bar(start + 4 * MINUTE_MS, 10.5, { volume: 5 }),
    );
    assert.deepEqual(done, [
      { time: start, open: 9, high: 13, low: 8, close: 10.5, volume: 15 },
    ]);
  });

  it('emits an unfinished bucket when a later bucket starts', () => {
    const aggregator = new BarAggregator(5);
    const start = at(DAY, '09:35');
    aggregator.push(bar(start, 1));
    aggregator.push(bar(start + MINUTE_MS, 2));
    const done = aggregator.push(bar(at(DAY, '09:41'), 3));
    assert.equal(done.length, 1);
    assert.equal(done[0]?.time, start);
    assert.equal(done[0]?.close, 2);
  });

  it('drops bars for buckets already emitted', () => {
    const aggregator = new BarAggregator(1);
    const start = at(DAY, '09:30');
    assert.equal(aggregator.push(bar(start, 1)).length, 1);
    assert.equal(aggregator.push(bar(start, 1)).length, 0);
    assert.equal(aggregator.push(bar(start - MINUTE_MS, 1)).length, 0);
  });

  it('passes 1-minute bars straight through', () => {
    const aggregator = new BarAggregator(1);
    const bars = minuteBars(at(DAY, '09:30'), [1, 2, 3]);
    assert.deepEqual(
      bars.flatMap((b) => aggregator.push(b)),
      bars,
    );
  });
});
