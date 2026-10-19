// Run with `nx test youtube-music-mobile` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizedVolume } from './loudness.ts';
import { playOrder, shuffled, unshuffledUpcoming } from './queue-order.ts';

/** Deterministic stand-in for Math.random. */
const seeded =
  (seed = 1) =>
  () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

describe('shuffled', () => {
  it('keeps every item', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const result = shuffled(items, seeded());
    assert.notDeepEqual(result, items);
    assert.deepEqual(
      [...result].sort((a, b) => a - b),
      items,
    );
  });
});

describe('playOrder', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('plays in order from the start index', () => {
    assert.deepEqual(playOrder(items, 2, { shuffle: false, limit: 10 }), {
      order: items,
      index: 2,
    });
  });

  it('puts the start first when shuffling', () => {
    const { order, index } = playOrder(
      items,
      3,
      { shuffle: true, limit: 10 },
      seeded(),
    );
    assert.equal(index, 0);
    assert.equal(order[0], 'd');
    assert.deepEqual([...order].sort(), items);
  });

  it('caps long queues from the start', () => {
    assert.deepEqual(playOrder(items, 1, { shuffle: false, limit: 2 }), {
      order: ['b', 'c'],
      index: 0,
    });
    assert.equal(
      playOrder(items, 1, { shuffle: true, limit: 2 }, seeded()).order.length,
      2,
    );
  });

  it('handles a bad index', () => {
    assert.deepEqual(playOrder(items, 9, { shuffle: false, limit: 10 }), {
      order: [],
      index: -1,
    });
  });
});

describe('unshuffledUpcoming', () => {
  const same = (a: string, b: string) => a === b;

  it('continues the original order after the current track', () => {
    assert.deepEqual(unshuffledUpcoming(['a', 'b', 'c', 'd'], 'b', same), [
      'c',
      'd',
    ]);
  });

  it('starts over when the current track is not in it', () => {
    assert.deepEqual(unshuffledUpcoming(['a', 'b'], 'z', same), ['a', 'b']);
  });
});

describe('normalizedVolume', () => {
  it('turns loud tracks down to the target', () => {
    assert.ok(Math.abs(normalizedVolume(-8) - 10 ** (-6 / 20)) < 1e-9);
  });

  it('leaves quiet and unmeasured tracks at full volume', () => {
    assert.equal(normalizedVolume(-20), 1);
    assert.equal(normalizedVolume(null), 1);
  });

  it('never goes silent', () => {
    assert.equal(normalizedVolume(20), 0.05);
  });
});
