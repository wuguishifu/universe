import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contract, DAY } from '../../testing/fixtures';
import { OptionContract } from '../market/types';

import { ContractConfig, ContractSelector } from './contract-selector';

const chain: OptionContract[] = [];
for (const expiration of ['2026-11-16', '2026-11-17', '2026-11-20']) {
  for (const type of ['call', 'put'] as const) {
    for (const strike of [98, 99, 100, 101, 102]) {
      chain.push(
        contract({
          symbol: `${expiration}-${type}-${strike}`,
          type,
          strike,
          expiration,
        }),
      );
    }
  }
}

const select = (
  config: Partial<ContractConfig>,
  type: 'call' | 'put' = 'call',
  underlyingPrice = 100.2,
) =>
  new ContractSelector({
    expiry: { type: 'nearest', minDte: 0 },
    strike: { type: 'atm' },
    filters: [],
    ...config,
  }).select({ chain, type, underlyingPrice, today: DAY });

const symbolOf = (result: ReturnType<typeof select>): string =>
  result.ok ? result.contract.symbol : `rejected: ${result.reason}`;

describe('ContractSelector', () => {
  it('picks the at-the-money strike of the nearest expiration', () => {
    assert.equal(symbolOf(select({})), '2026-11-16-call-100');
  });

  it('breaks an exact tie toward the lower strike', () => {
    assert.equal(symbolOf(select({}, 'call', 100.5)), '2026-11-16-call-100');
  });

  it('skips expirations under minDte', () => {
    assert.equal(
      symbolOf(select({ expiry: { type: 'nearest', minDte: 2 } })),
      '2026-11-20-call-100',
    );
  });

  it('rejects when nothing is inside the DTE range', () => {
    assert.equal(
      symbolOf(select({ expiry: { type: 'nearest', minDte: 2, maxDte: 3 } })),
      'rejected: no expiration fits',
    );
  });

  it('moves out of the money in the right direction for calls and puts', () => {
    const offset = { strike: { type: 'strikeOffset', steps: 1 } } as const;
    assert.equal(symbolOf(select(offset, 'call')), '2026-11-16-call-101');
    assert.equal(symbolOf(select(offset, 'put')), '2026-11-16-put-99');
  });

  it('rejects an offset past the end of the chain', () => {
    assert.equal(
      symbolOf(select({ strike: { type: 'strikeOffset', steps: 5 } })),
      'rejected: no strike fits on 2026-11-16',
    );
  });

  it('skips the trade when the chosen contract fails a filter', () => {
    // 1.00 / 1.04 is a 3.9% spread
    assert.equal(
      symbolOf(select({ filters: [{ type: 'maxSpreadPct', pct: 0.04 }] })),
      '2026-11-16-call-100',
    );
    assert.equal(
      symbolOf(select({ filters: [{ type: 'maxSpreadPct', pct: 0.03 }] })),
      'rejected: 2026-11-16-call-100 rejected by maxSpreadPct',
    );
    assert.equal(
      symbolOf(select({ filters: [{ type: 'minOpenInterest', count: 1 }] })),
      'rejected: 2026-11-16-call-100 rejected by minOpenInterest',
    );
  });
});
