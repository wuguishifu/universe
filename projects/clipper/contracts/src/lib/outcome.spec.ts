// Run with `nx test clipper-contracts` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTimestamp,
  type ModelOutput,
  parseTimestamp,
  type Segment,
  toOutcome,
} from './outcome.ts';

const segment = (startSec: number, endSec: number, confidence = 0.8) => ({
  reasoning: 'they all scream',
  startSec,
  endSec,
  title: 'no way',
  category: 'funny' as const,
  confidence,
});
/** The model's version of a segment, with M:SS timestamps. */
const answer = ({ startSec, endSec, ...rest }: Segment) => ({
  ...rest,
  start: timestamp(startSec),
  end: timestamp(endSec),
});
const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const found = (...segments: Segment[]): ModelOutput => ({
  found: true,
  segments: segments.map(answer),
});

describe('parseTimestamp', () => {
  it('reads M:SS, MM:SS, H:MM:SS and fractions', () => {
    assert.equal(parseTimestamp('1:47'), 107);
    assert.equal(parseTimestamp(' 01:05.5 '), 65.5);
    assert.equal(parseTimestamp('0:00'), 0);
    assert.equal(parseTimestamp('1:02:03'), 3723);
    assert.equal(parseTimestamp('1:60'), 120);
  });

  it("rejects what isn't a timestamp", () => {
    for (const text of ['147', '1:75', '1:5', 'a:bc', '', '1:60:00']) {
      assert.equal(parseTimestamp(text), null, text);
    }
  });

  it('round-trips with formatTimestamp', () => {
    assert.equal(formatTimestamp(107), '1:47');
    assert.equal(formatTimestamp(59.6), '1:00');
    assert.equal(parseTimestamp(formatTimestamp(754)), 754);
  });
});
const full = { mediaDurationSec: 120, offsetSec: 0 };

describe('toOutcome', () => {
  it('passes a good answer through', () => {
    assert.deepEqual(toOutcome(found(segment(90, 110)), full), {
      ok: true,
      outcome: { status: 'found', segments: [segment(90, 110)] },
    });
  });

  it('keeps the reason when nothing was found', () => {
    assert.deepEqual(
      toOutcome(
        { found: false, notFoundReason: ' just walking ', segments: [] },
        full,
      ),
      { ok: true, outcome: { status: 'not_found', reason: 'just walking' } },
    );
  });

  it('moves timestamps onto the full clip when only the tail was sent', () => {
    const result = toOutcome(found(segment(10, 30)), {
      mediaDurationSec: 45,
      offsetSec: 75,
    });
    assert.ok(result.ok && result.outcome.status === 'found');
    assert.deepEqual(
      result.outcome.segments.map((s) => [s.startSec, s.endSec]),
      [[85, 105]],
    );
  });

  it('pulls an end just past the media back to the end', () => {
    const result = toOutcome(found(segment(100, 121)), full);
    assert.ok(result.ok && result.outcome.status === 'found');
    assert.equal(result.outcome.segments[0]?.endSec, 120);
  });

  it('grows a too-short segment to the minimum, backwards at the end', () => {
    const result = toOutcome(found(segment(50, 51), segment(119, 120)), full);
    assert.ok(result.ok && result.outcome.status === 'found');
    assert.deepEqual(
      result.outcome.segments.map((s) => [s.startSec, s.endSec]),
      [
        [50, 53],
        [117, 120],
      ],
    );
  });

  it('reads a confidence out of 100', () => {
    const result = toOutcome(found(segment(10, 20, 85)), full);
    assert.ok(result.ok && result.outcome.status === 'found');
    assert.equal(result.outcome.segments[0]?.confidence, 0.85);
  });

  it('keeps the most confident segments, in order', () => {
    const result = toOutcome(
      found(
        segment(80, 90, 0.9),
        segment(10, 20, 0.2),
        segment(40, 50, 0.7),
        segment(0, 5, 0.8),
      ),
      full,
    );
    assert.ok(result.ok && result.outcome.status === 'found');
    assert.deepEqual(
      result.outcome.segments.map((s) => s.startSec),
      [0, 40, 80],
    );
  });

  it('rejects answers it would have to guess at', () => {
    for (const [output, error] of [
      [found(), /no segments/],
      [found(segment(100, 130)), /past the end/],
      [
        { found: true, segments: [{ ...answer(segment(0, 10)), end: '147' }] },
        /M:SS/,
      ],
      [found(segment(30, 20)), /ends before/],
      [found(segment(0, 61)), /longer than/],
      [found(segment(10, 30), segment(25, 40)), /overlap/],
    ] as const) {
      const result = toOutcome(output, full);
      assert.equal(result.ok, false);
      assert.match(!result.ok ? result.error : '', error);
    }
  });
});
