import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPositionSizer } from '../sizing/position-sizer';

import { createRiskRule } from './risk-rules';

const input = { price: 1.5, multiplier: 100, equity: 10_000 };

describe('position sizing', () => {
  it('buys a fixed count', () => {
    assert.equal(
      createPositionSizer({ type: 'contracts', count: 2 }).size(input),
      2,
    );
  });

  it('buys as many whole contracts as a dollar amount covers', () => {
    assert.equal(
      createPositionSizer({ type: 'dollars', amount: 500 }).size(input),
      3,
    );
  });

  it('sizes from equity, and buys nothing while equity is unknown', () => {
    const sizer = createPositionSizer({ type: 'pctEquity', pct: 0.05 });
    assert.equal(sizer.size(input), 3);
    assert.equal(sizer.size({ ...input, equity: undefined }), 0);
  });
});

describe('risk rules', () => {
  const risk = {
    costPerContract: 150,
    tiedCapital: 700,
    positions: 2,
    equity: 10_000,
  };

  it('caps contracts at the capital left under maxTiedCapital', () => {
    const rule = createRiskRule({ type: 'maxTiedCapital', dollars: 1_000 });
    assert.equal(rule.maxContracts(risk), 2);
    assert.equal(rule.maxContracts({ ...risk, tiedCapital: 1_200 }), 0);
  });

  it('uses the tighter of dollars and pctEquity', () => {
    const rule = createRiskRule({
      type: 'maxTiedCapital',
      dollars: 5_000,
      pctEquity: 0.1,
    });
    assert.equal(rule.maxContracts(risk), 2);
    assert.equal(rule.maxContracts({ ...risk, equity: undefined }), 0);
  });

  it('blocks entries at maxPositions', () => {
    const rule = createRiskRule({ type: 'maxPositions', count: 2 });
    assert.equal(rule.maxContracts(risk), 0);
    assert.equal(
      rule.maxContracts({ ...risk, positions: 1 }),
      Number.POSITIVE_INFINITY,
    );
  });
});
