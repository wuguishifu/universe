// Run with `nx test thermo-automation-web` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseDurationMinutes,
  parsePauseInput,
  utcOffsetMinutes,
  zonedTimeToUtc,
} from './house-time.ts';

// Saturday 2026-10-17, 3:00 PM in Chicago (CDT, UTC-5).
const now = new Date('2026-10-17T20:00:00Z');
const timeZone = 'America/Chicago';
const parse = (text: string) =>
  parsePauseInput(text, { now, timeZone })?.toISOString() ?? null;

describe('parseDurationMinutes', () => {
  for (const [text, minutes] of [
    ['1h30', 90],
    ['1.5h', 90],
    ['90m', 90],
    ['2h15m', 135],
    ['1h 30m', 90],
    ['45 min', 45],
    ['3 hours', 180],
    ['1d', 1440],
  ] as const) {
    it(`reads "${text}" as ${minutes} minutes`, () => {
      assert.equal(parseDurationMinutes(text), minutes);
    });
  }

  for (const text of ['30', 'tomorrow', '5pm', '1x', 'h', '0h']) {
    it(`doesn't read "${text}" as a duration`, () => {
      assert.equal(parseDurationMinutes(text), null);
    });
  }
});

describe('parsePauseInput', () => {
  it('adds durations to now', () => {
    assert.equal(parse('1h30'), '2026-10-17T21:30:00.000Z');
    assert.equal(parse('for 1.5h'), '2026-10-17T21:30:00.000Z');
  });

  it('reads times in the house timezone', () => {
    assert.equal(parse('tomorrow at 5 pm'), '2026-10-18T22:00:00.000Z');
    assert.equal(
      parse('until 2026-10-18 18:00:00'),
      '2026-10-18T23:00:00.000Z',
    );
    assert.equal(parse('in 2 hours'), '2026-10-17T22:00:00.000Z');
  });

  it('puts a bare day at 6 AM', () => {
    assert.equal(parse('until tomorrow'), '2026-10-18T11:00:00.000Z');
    assert.equal(parse('friday'), '2026-10-23T11:00:00.000Z');
  });

  it('keeps the time a time of day implies', () => {
    assert.equal(parse('tonight'), '2026-10-18T03:00:00.000Z');
  });

  it('picks the next occurrence of a time that has passed today', () => {
    assert.equal(parse('noon'), '2026-10-18T17:00:00.000Z');
  });

  it('rejects text it only partly understands, or nothing at all', () => {
    assert.equal(parse('tomorrow-ish maybe'), null);
    assert.equal(parse('banana'), null);
    assert.equal(parse('   '), null);
  });

  it("uses the house's offset on the date asked for, not today's", () => {
    // Chicago is on CST (UTC-6) after 2026-11-01.
    assert.equal(parse('nov 2 6am'), '2026-11-02T12:00:00.000Z');
    assert.equal(parse('until 2026-11-02 06:00'), '2026-11-02T12:00:00.000Z');
  });

  it('rejects durations too long to be a date', () => {
    assert.equal(parse('999999999999h'), null);
  });

  it('rejects times in the past', () => {
    assert.equal(parse('2026-10-16 18:00'), null);
  });
});

describe('zonedTimeToUtc', () => {
  it('handles both sides of a DST change', () => {
    // DST in Chicago ends on 2026-11-01 at 2:00 AM.
    assert.equal(
      zonedTimeToUtc(
        { year: 2026, month: 10, day: 31, hour: 6, minute: 0 },
        timeZone,
      ).toISOString(),
      '2026-10-31T11:00:00.000Z',
    );
    assert.equal(
      zonedTimeToUtc(
        { year: 2026, month: 11, day: 2, hour: 6, minute: 0 },
        timeZone,
      ).toISOString(),
      '2026-11-02T12:00:00.000Z',
    );
  });

  it('reports the offset', () => {
    assert.equal(utcOffsetMinutes(now, timeZone), -300);
    assert.equal(utcOffsetMinutes(now, 'Asia/Kolkata'), 330);
  });
});
