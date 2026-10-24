// Run with `nx test clipper-contracts` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { costUsd } from './pricing.ts';

describe('costUsd', () => {
  const usage = {
    input: 12_000,
    audioInput: 4_000,
    output: 500,
    thinking: 1_500,
  };

  it('charges audio at its own price', () => {
    // 12k × $0.30 + 4k × $1.00 + 2k × $2.50, per million
    assert.equal(
      costUsd('gemini-2.5-flash', usage, new Date('2026-10-11')).toFixed(6),
      '0.012600',
    );
  });

  it('uses the price for the day of the call', () => {
    const before = costUsd(
      'gemini-3.8-flash',
      usage,
      new Date('2026-12-31T23:59:59Z'),
    );
    const after = costUsd(
      'gemini-3.8-flash',
      usage,
      new Date('2027-01-01T00:00:00Z'),
    );
    assert.equal(before.toFixed(6), '0.019500');
    assert.equal(after.toFixed(6), (before * 2).toFixed(6));
  });
});
