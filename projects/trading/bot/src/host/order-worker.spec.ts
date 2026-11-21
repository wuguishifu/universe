import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { OrderIntent, OrderUpdate } from '@projects/trading-core';

import {
  FillRule,
  QuoteBook,
  ReplayBroker,
  ReplayTimers,
} from '../replay/fakes';
import { ReplayFixture } from '../replay/fixture';

import { OrderTracker } from './order-tracker';
import { OrderWorker, roundDown, roundUp } from './order-worker';
import { BrokerOrderRequest, silentLog } from './ports';
import { hostSettingsSchema } from './settings';

const T0 = Date.parse('2026-11-16T15:00:00Z');
const SYMBOL = 'QQQ261117C00600000';

/** One contract quoted 1.00 / 1.05 all day. */
const fixture: ReplayFixture = {
  description: 'one quote',
  generatedAt: '',
  config: '',
  windows: [],
  calendar: [],
  ticker: 'QQQ',
  bars: {},
  quotes: { '2026-11-16': { [SYMBOL]: [[T0 - 60_000, 1, 1.05]] } },
};

function setup(fillRule?: FillRule) {
  const timers = new ReplayTimers(T0);
  const broker = new ReplayBroker(new QuoteBook(fixture), timers);
  if (fillRule) broker.fillRule = fillRule;
  const tracker = new OrderTracker();
  broker.onUpdate = (_event, order) => tracker.update(order);
  const settings = hostSettingsSchema.parse({});
  const worker = new OrderWorker({
    broker,
    tracker,
    timers,
    settings,
    log: silentLog,
    onOrder: () => undefined,
  });
  const updates: OrderUpdate[] = [];
  const report = (update: OrderUpdate) => {
    updates.push(update);
    return Promise.resolve();
  };
  return { timers, broker, worker, updates, report, settings };
}

const intent = (partial: Partial<OrderIntent>): OrderIntent => ({
  id: 'tb-t-261116-o1',
  action: 'open',
  positionId: 'p1',
  ticker: 'QQQ',
  symbol: SYMBOL,
  side: 'buy',
  qty: 2,
  refPrice: 1.05,
  time: T0,
  ...partial,
});

describe('OrderWorker', () => {
  it('buys with a limit a little above the ask and reports the fill', async () => {
    const { worker, broker, updates, report } = setup();
    const result = await worker.work(intent({}), report);
    assert.deepEqual(
      broker.requests.map((r) => [r.type, r.limitPrice]),
      [['limit', 1.07]],
    );
    assert.equal(result.status, 'filled');
    assert.equal(result.filledQty, 2);
    assert.equal(result.avgFillPrice, 1.05);
    assert.deepEqual(updates, [result]);
  });

  it('cancels an entry that only partly fills by the timeout and keeps what filled', async () => {
    const partOnce: FillRule = (request, quote) =>
      request.side === 'buy' && quote
        ? { fillQty: 1, price: quote.ask }
        : 'rest';
    const { worker, updates, report, timers, settings } = setup(partOnce);
    const result = await worker.work(intent({}), report);
    assert.equal(result.status, 'canceled');
    assert.equal(result.filledQty, 1);
    assert.equal(result.avgFillPrice, 1.05);
    assert.equal(updates.length, 1);
    assert.ok(timers.now() - T0 >= settings.entryTimeoutMs);
  });

  it('steps an exit down from the bid, then sells at market', async () => {
    // Nothing fills at a limit: the market moved away.
    const onlyMarket: FillRule = (request, quote) =>
      request.type === 'market' && quote
        ? { fillQty: request.qty, price: 0.9 }
        : 'rest';
    const { worker, broker, report, settings } = setup(onlyMarket);
    const result = await worker.work(
      intent({ action: 'close', side: 'sell', refPrice: 1.04, qty: 1 }),
      report,
      { quote: () => ({ symbol: SYMBOL, bid: 1.04, ask: 1.06, time: T0 }) },
    );
    const sent = broker.requests.map(
      (r: BrokerOrderRequest) => r.limitPrice ?? r.type,
    );
    assert.deepEqual(sent, [1.04, 1.03, 1.02, 1.01, 1, 'market']);
    assert.equal(sent.length, settings.exitMaxSteps + 2);
    assert.equal(result.status, 'filled');
    assert.equal(result.avgFillPrice, 0.9);
  });

  it('adds up fills across the orders an exit takes and reports partials on the way', async () => {
    let n = 0;
    const onePerOrder: FillRule = () => {
      n += 1;
      return { fillQty: 1, price: n === 1 ? 1.04 : 1.02 };
    };
    const { worker, updates, report, broker } = setup(onePerOrder);
    const result = await worker.work(
      intent({ action: 'close', side: 'sell', refPrice: 1.04, qty: 3 }),
      report,
    );
    assert.deepEqual(
      broker.requests.map((r) => r.qty),
      [3, 2, 1],
    );
    assert.deepEqual(
      updates.map((u) => [u.status, u.filledQty]),
      [
        ['partiallyFilled', 1],
        ['partiallyFilled', 2],
        ['filled', 3],
      ],
    );
    assert.equal(
      result.avgFillPrice.toFixed(4),
      ((1.04 + 1.02 + 1.02) / 3).toFixed(4),
    );
    assert.deepEqual(
      broker.requests.map((r) => r.clientOrderId),
      ['tb-t-261116-o1', 'tb-t-261116-o1-1', 'tb-t-261116-o1-2'],
    );
  });

  it('goes straight to market when urgent', async () => {
    const { worker, broker, report } = setup();
    await worker.work(
      intent({ action: 'close', side: 'sell', qty: 1 }),
      report,
      {
        urgent: () => true,
      },
    );
    assert.deepEqual(
      broker.requests.map((r) => r.type),
      ['market'],
    );
  });

  it('waits for the open before sending, and gives up on an entry when aborted', async () => {
    const { worker, broker, report, timers } = setup();
    const open = T0 + 30 * 60_000;
    await worker.work(
      intent({ action: 'close', side: 'sell', qty: 1, refPrice: 1 }),
      report,
      {
        notBefore: open,
      },
    );
    assert.ok(timers.now() >= open);
    assert.equal(broker.requests.length, 1);

    const aborted = await worker.work(
      intent({ id: 'tb-t-261116-o9' }),
      report,
      { abort: () => true },
    );
    assert.equal(aborted.status, 'canceled');
    assert.equal(broker.requests.length, 1);
  });

  it('reports a refused entry as rejected', async () => {
    const { worker, report } = setup(() => 'reject');
    const result = await worker.work(intent({}), report);
    assert.equal(result.status, 'rejected');
    assert.equal(result.filledQty, 0);
  });

  it('rounds limit prices to the tick', () => {
    assert.equal(roundUp(1.051, 0.01), 1.06);
    assert.equal(roundUp(1.05, 0.01), 1.05);
    assert.equal(roundDown(1.059, 0.01), 1.05);
    assert.equal(roundDown(0.07 * 3, 0.01), 0.21);
  });
});
