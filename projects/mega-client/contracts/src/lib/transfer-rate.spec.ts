// Run with `nx test mega-client-contracts` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { etaSeconds, TransferRates } from './transfer-rate.ts';

const MB = 1024 ** 2;

describe('TransferRates', () => {
  it('needs a second of samples before it has a speed', () => {
    const rates = new TransferRates();
    rates.record(0, [{ tag: '1', bytes: 0, moving: true }]);
    assert.equal(rates.bytesPerSecond('1'), null);
    rates.record(500, [{ tag: '1', bytes: MB, moving: true }]);
    assert.equal(rates.bytesPerSecond('1'), null);
    rates.record(2_000, [{ tag: '1', bytes: 4 * MB, moving: true }]);
    assert.equal(rates.bytesPerSecond('1'), 2 * MB);
  });

  it('averages over the window only', () => {
    const rates = new TransferRates(10_000);
    // 1 MB/s for 10s, then 5 MB/s for 10s.
    let bytes = 0;
    for (let at = 0; at <= 20_000; at += 2_000) {
      rates.record(at, [{ tag: '1', bytes, moving: true }]);
      bytes += at < 10_000 ? 2 * MB : 10 * MB;
    }
    assert.equal(rates.bytesPerSecond('1'), 5 * MB);
  });

  it('starts over when a transfer stops moving', () => {
    const rates = new TransferRates();
    rates.record(0, [{ tag: '1', bytes: 0, moving: true }]);
    rates.record(2_000, [{ tag: '1', bytes: 2 * MB, moving: true }]);
    rates.record(4_000, [{ tag: '1', bytes: 2 * MB, moving: false }]);
    assert.equal(rates.bytesPerSecond('1'), null);
    rates.record(6_000, [{ tag: '1', bytes: 2 * MB, moving: true }]);
    assert.equal(rates.bytesPerSecond('1'), null);
  });

  it('starts over when progress goes backwards', () => {
    const rates = new TransferRates();
    rates.record(0, [{ tag: '1', bytes: 0, moving: true }]);
    rates.record(2_000, [{ tag: '1', bytes: 8 * MB, moving: true }]);
    rates.record(4_000, [{ tag: '1', bytes: MB, moving: true }]);
    assert.equal(rates.bytesPerSecond('1'), null);
  });

  it('forgets transfers that are gone', () => {
    const rates = new TransferRates();
    rates.record(0, [{ tag: '1', bytes: 0, moving: true }]);
    rates.record(2_000, [{ tag: '1', bytes: 2 * MB, moving: true }]);
    rates.record(4_000, []);
    rates.record(6_000, [{ tag: '1', bytes: 6 * MB, moving: true }]);
    assert.equal(rates.bytesPerSecond('1'), null);
  });
});

describe('etaSeconds', () => {
  it('rounds up', () => assert.equal(etaSeconds(10 * MB, 3 * MB), 4));
  it('is null without a speed', () => {
    assert.equal(etaSeconds(MB, null), null);
    assert.equal(etaSeconds(MB, 0), null);
  });
});
