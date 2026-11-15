import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { at, bar, DAY } from '../../testing/fixtures';

import { Ema } from './ema';
import { priceOf } from './indicator';
import { Vwap } from './vwap';

const t = at(DAY, '09:30');

describe('priceOf', () => {
  it('computes the composite sources', () => {
    const b = bar(t, 10, { open: 8, high: 14, low: 6 });
    assert.equal(priceOf(b, 'hl2'), 10);
    assert.equal(priceOf(b, 'hlc3'), 10);
    assert.equal(priceOf(b, 'ohlc4'), 9.5);
  });
});

describe('Ema', () => {
  it('seeds with the simple average, then smooths', () => {
    // length 3 → alpha 0.5
    const ema = new Ema({
      type: 'ema',
      length: 3,
      source: 'close',
      warmup: 'carryOver',
    });
    assert.equal(ema.update(bar(t, 1)), undefined);
    assert.equal(ema.update(bar(t, 2)), undefined);
    assert.equal(ema.update(bar(t, 3)), 2);
    assert.equal(ema.update(bar(t, 4)), 3);
    assert.equal(ema.update(bar(t, 6)), 4.5);
  });

  it('carries over sessions by default', () => {
    const ema = new Ema({
      type: 'ema',
      length: 2,
      source: 'close',
      warmup: 'carryOver',
    });
    ema.update(bar(t, 1));
    ema.update(bar(t, 3));
    ema.startSession();
    assert.equal(ema.value, 2);
  });

  it('starts over each session with resetDaily', () => {
    const ema = new Ema({
      type: 'ema',
      length: 2,
      source: 'close',
      warmup: 'resetDaily',
    });
    ema.update(bar(t, 1));
    ema.update(bar(t, 3));
    ema.startSession();
    assert.equal(ema.value, undefined);
    assert.equal(ema.update(bar(t, 10)), undefined);
    assert.equal(ema.update(bar(t, 20)), 15);
  });
});

describe('Vwap', () => {
  it('weights the source price by volume', () => {
    const vwap = new Vwap({ type: 'vwap', source: 'ohlc4' });
    // ohlc4 = 10, volume 100
    vwap.update(bar(t, 10, { open: 10, high: 12, low: 8, volume: 100 }));
    // ohlc4 = 12, volume 300
    const value = vwap.update(
      bar(t, 14, { open: 10, high: 14, low: 10, volume: 300 }),
    );
    assert.equal(value, 11.5);
  });

  it('resets each session and waits for volume', () => {
    const vwap = new Vwap({ type: 'vwap', source: 'close' });
    vwap.update(bar(t, 10));
    vwap.startSession();
    assert.equal(vwap.value, undefined);
    assert.equal(vwap.update(bar(t, 20, { volume: 0 })), undefined);
    assert.equal(vwap.update(bar(t, 30)), 30);
  });
});
