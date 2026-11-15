import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMA_VWAP_CROSSOVER } from '../presets/ema-vwap-crossover';

import { parseStrategyConfig } from './strategy-config';

describe('parseStrategyConfig', () => {
  it('accepts the EMA/VWAP preset', () => {
    const config = parseStrategyConfig(EMA_VWAP_CROSSOVER);
    assert.equal(config.indicators['ema9']?.type, 'ema');
    assert.equal(config.exits.length, 5);
  });

  it('fills in defaults', () => {
    const config = parseStrategyConfig({
      tickers: ['SPY'],
      timeframeMinutes: 1,
      indicators: { fast: { type: 'ema', length: 9 }, slow: { type: 'vwap' } },
      signal: { type: 'crossover', fast: 'fast', slow: 'slow' },
      exits: [{ type: 'flatBeforeClose' }],
      contract: { expiry: { type: 'nearest' }, strike: { type: 'atm' } },
      sizing: { type: 'contracts', count: 1 },
    });
    assert.deepEqual(config.indicators['fast'], {
      type: 'ema',
      length: 9,
      source: 'close',
      warmup: 'carryOver',
    });
    assert.deepEqual(config.indicators['slow'], {
      type: 'vwap',
      source: 'ohlc4',
    });
    assert.equal(config.session, 'regular');
    assert.equal(config.markPrice, 'mid');
    assert.deepEqual(config.exits, [{ type: 'flatBeforeClose', minutes: 10 }]);
  });

  it('rejects references to indicators that are not defined', () => {
    assert.throws(
      () =>
        parseStrategyConfig({
          ...EMA_VWAP_CROSSOVER,
          exits: [{ type: 'indicatorBreak', indicator: 'ema20' }],
        }),
      /Unknown indicator "ema20"/,
    );
  });

  it('rejects timeframes that do not line up with the open', () => {
    assert.throws(
      () => parseStrategyConfig({ ...EMA_VWAP_CROSSOVER, timeframeMinutes: 4 }),
      /timeframeMinutes must be one of/,
    );
  });
});
