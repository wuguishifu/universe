import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Direction } from '../strategy/types';

import { Crossover } from './crossover';

/** Runs [fast, slow] pairs through a fresh crossover and returns each bar's signal. */
function run(
  pairs: Array<[number | undefined, number]>,
  signal = new Crossover({ type: 'crossover', fast: 'f', slow: 's' }),
): Array<Direction | null> {
  return pairs.map(([f, s]) => signal.update({ f, s }));
}

describe('Crossover', () => {
  it('fires once when fast crosses above, and once when it crosses back below', () => {
    assert.deepEqual(
      run([
        [1, 2],
        [3, 2],
        [4, 2],
        [1, 2],
        [0, 2],
      ]),
      [null, 'bullish', null, 'bearish', null],
    );
  });

  it('needs a side before it can cross', () => {
    assert.deepEqual(
      run([
        [3, 2],
        [4, 2],
      ]),
      [null, null],
    );
  });

  it('ignores warming-up indicators', () => {
    assert.deepEqual(
      run([
        [undefined, 2],
        [1, 2],
        [3, 2],
      ]),
      [null, null, 'bullish'],
    );
  });

  it('treats a touch as no side, so touch-and-bounce is not a cross', () => {
    assert.deepEqual(
      run([
        [3, 2],
        [2, 2],
        [3, 2],
      ]),
      [null, null, null],
    );
    assert.deepEqual(
      run([
        [1, 2],
        [2, 2],
        [3, 2],
      ]),
      [null, null, 'bullish'],
    );
  });

  it('forgets its side at the start of a session', () => {
    const signal = new Crossover({ type: 'crossover', fast: 'f', slow: 's' });
    run([[1, 2]], signal);
    signal.startSession();
    assert.deepEqual(run([[3, 2]], signal), [null]);
  });
});
