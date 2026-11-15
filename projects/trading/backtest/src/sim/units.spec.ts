import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OrderIntent } from '@projects/trading-core';

import { occSymbol, parseOccSymbol } from '../data/alpaca';
import { optionSymbolsFor } from '../download/download';
import { normalizeSkipReason } from '../report/stats';

import { OptionBarIndex } from './backtest';
import { HistoricalChains, lastClosedBar } from './historical-chains';
import { modelQuote, roundToCent } from './quotes';
import { SimulatedBroker } from './simulated-broker';
import { simulationConfigSchema } from './simulation-config';

const minute = (hhmm: string): number =>
  Date.parse(`2026-11-16T${hhmm}:00-05:00`);
const bar = (hhmm: string, close: number) => ({
  time: minute(hhmm),
  open: close,
  high: close,
  low: close,
  close,
  volume: 10,
});

describe('OCC symbols', () => {
  it('round-trips', () => {
    const contract = {
      underlying: 'SPY',
      expiration: '2026-11-17',
      type: 'call',
      strike: 590,
    } as const;
    assert.equal(occSymbol(contract), 'SPY261117C00590000');
    assert.deepEqual(parseOccSymbol('SPY261117C00590000'), contract);
  });

  it('handles half-dollar strikes and puts', () => {
    assert.deepEqual(parseOccSymbol('QQQ261120P00512500'), {
      underlying: 'QQQ',
      expiration: '2026-11-20',
      type: 'put',
      strike: 512.5,
    });
    assert.equal(parseOccSymbol('not-a-symbol'), null);
  });
});

describe('optionSymbolsFor', () => {
  it('covers each expiry in range and each padded strike, calls and puts', () => {
    const symbols = optionSymbolsFor(
      'SPY',
      '2026-11-16',
      { low: 100.4, high: 100.6 },
      ['2026-11-13', '2026-11-16', '2026-11-17', '2026-11-27'],
      { expiryDays: 7, strikePadding: 1, strikeStep: 1 },
    );
    // 2 expirations × strikes 99..102 × 2 sides
    assert.equal(symbols.length, 16);
    assert.ok(symbols.includes('SPY261116C00099000'));
    assert.ok(symbols.includes('SPY261117P00102000'));
    assert.ok(
      !symbols.some((s) => s.includes('261113') || s.includes('261127')),
    );
  });
});

describe('modeled quotes', () => {
  it('spreads around the traded price, never below the minimum', () => {
    const cents = (q: { bid: number; ask: number }) => [
      q.bid.toFixed(4),
      q.ask.toFixed(4),
    ];
    assert.deepEqual(
      cents(modelQuote(2, { spreadPct: 0.04, minSpread: 0.01 })),
      ['1.9600', '2.0400'],
    );
    assert.deepEqual(
      cents(modelQuote(0.1, { spreadPct: 0.04, minSpread: 0.02 })),
      ['0.0900', '0.1100'],
    );
  });

  it('rounds fills against the trader', () => {
    assert.equal(roundToCent(1.015, 'buy'), 1.02);
    assert.equal(roundToCent(1.015, 'sell'), 1.01);
    assert.equal(roundToCent(1.03, 'buy'), 1.03);
    assert.equal(roundToCent(0.07, 'sell'), 0.07);
  });
});

describe('HistoricalChains', () => {
  const simulation = simulationConfigSchema.parse({
    spreadPct: 0,
    minSpread: 0,
    maxPriceAgeMinutes: 5,
  });
  const chains = new HistoricalChains(simulation);
  chains.load(
    'SPY',
    new Map([
      [
        'SPY261117C00100000',
        [bar('09:30', 1), bar('09:31', 1.1), bar('09:32', 1.2)],
      ],
      ['SPY261117C00101000', [bar('09:20', 0.5)]],
      ['SPY261117P00100000', [bar('09:30', 2)]],
    ]),
  );
  const request = {
    underlying: 'SPY',
    type: 'call',
    underlyingPrice: 100,
  } as const;

  it('prices from the last bar closed by the request time', async () => {
    // At 09:32:00 the 09:31 bar has closed but the 09:32 bar hasn't.
    const chain = await chains.getChain({ ...request, time: minute('09:32') });
    assert.deepEqual(
      chain.map((c) => [c.symbol, c.ask]),
      [['SPY261117C00100000', 1.1]],
    );
  });

  it('leaves out contracts that have not traded recently, and the other type', async () => {
    const chain = await chains.getChain({ ...request, time: minute('09:26') });
    assert.deepEqual(
      chain.map((c) => c.symbol),
      ['SPY261117C00101000'],
    );
  });

  it('lastClosedBar finds nothing before the first bar closes', () => {
    assert.equal(
      lastClosedBar([bar('09:30', 1)], minute('09:30') + 59_000),
      undefined,
    );
  });
});

describe('normalizeSkipReason', () => {
  it('groups reasons that only differ by contract or date', () => {
    assert.equal(
      normalizeSkipReason('SPY261117C00100000 rejected by maxSpreadPct'),
      'contract rejected by maxSpreadPct',
    );
    assert.equal(
      normalizeSkipReason('no strike fits on 2026-11-17'),
      'no strike fits',
    );
    assert.equal(
      normalizeSkipReason('blocked by cooldown'),
      'blocked by cooldown',
    );
  });
});

describe('next-trade fills', () => {
  const index = new OptionBarIndex();
  index.load(
    new Map([
      [
        'SPY261117C00100000',
        [
          { ...bar('09:39', 1.2), open: 1.1, low: 1.05, high: 1.3 },
          { ...bar('09:42', 2), open: 1.9 },
        ],
      ],
    ]),
  );
  const symbol = 'SPY261117C00100000';

  it('finds the first replayed price at or after the order', () => {
    // An order at the bar's start fills at its open; 10s in, at the low (15s); 50s in, at the next bar.
    assert.deepEqual(
      index.firstPriceAtOrAfter(symbol, minute('09:39'), 300_000),
      { price: 1.1, time: minute('09:39') },
    );
    assert.deepEqual(
      index.firstPriceAtOrAfter(symbol, minute('09:39') + 10_000, 300_000),
      {
        price: 1.05,
        time: minute('09:39') + 15_000,
      },
    );
    assert.deepEqual(
      index.firstPriceAtOrAfter(symbol, minute('09:39') + 50_000, 300_000),
      {
        price: 1.9,
        time: minute('09:42'),
      },
    );
    assert.equal(
      index.firstPriceAtOrAfter(symbol, minute('09:39') + 50_000, 60_000),
      undefined,
    );
  });

  it('fills a price-triggered exit on the next print, never better than the trigger', () => {
    // The 09:39 path is 1.10 (0s), 1.05 (15s), 1.30 (30s), 1.20 (45s).
    const t = minute('09:39');
    assert.deepEqual(index.priceAfterTrigger(symbol, t + 30_000, 300_000), {
      price: 1.2,
      time: t + 45_000,
    });
    assert.deepEqual(index.priceAfterTrigger(symbol, t + 15_000, 300_000), {
      price: 1.05,
      time: t + 30_000,
    });
    assert.deepEqual(index.priceAfterTrigger(symbol, t + 45_000, 300_000), {
      price: 1.2,
      time: minute('09:42'),
    });
    assert.deepEqual(index.priceAfterTrigger(symbol, t + 45_000, 60_000), {
      price: 1.2,
      time: t + 45_000,
    });
  });

  const order: OrderIntent = {
    id: 'o1',
    action: 'open',
    positionId: 'p1',
    ticker: 'SPY',
    symbol,
    side: 'buy',
    qty: 1,
    refPrice: 1.0,
    time: minute('09:39'),
  };

  it('buys at the ask around the next trade, not the price seen at the decision', () => {
    const broker = new SimulatedBroker(
      simulationConfigSchema.parse({ spreadPct: 0.02, feePerContract: 0 }),
    );
    const update = broker.fill(order, 100, {
      price: 1.1,
      time: minute('09:39'),
    });
    assert.equal(update.avgFillPrice, 1.12); // 1.10 + a 1% half-spread = 1.111, rounded up to 1.12
    assert.equal(update.time, minute('09:39'));
  });

  it('rejects when nothing trades in time, and can still fill at the decision price', () => {
    const next = new SimulatedBroker(simulationConfigSchema.parse({}));
    assert.equal(next.fill(order, 100, undefined).status, 'rejected');
    assert.equal(next.cash, 25_000);

    const decision = new SimulatedBroker(
      simulationConfigSchema.parse({ fillAt: 'decision', feePerContract: 0 }),
    );
    assert.equal(decision.fill(order, 100, undefined).avgFillPrice, 1);
  });
});
