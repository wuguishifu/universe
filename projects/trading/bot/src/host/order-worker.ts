import { OrderIntent, OrderUpdate } from '@projects/trading-core';

import { OrderTracker } from './order-tracker';
import {
  Broker,
  BrokerOrder,
  BrokerOrderRequest,
  isFinal,
  Log,
  OptionQuoteSnapshot,
  OrderRejectedError,
  Timers,
} from './ports';
import { HostSettings } from './settings';

export type OrderWorkerDeps = {
  broker: Broker;
  tracker: OrderTracker;
  timers: Timers;
  settings: HostSettings;
  log: Log;
  /** Called with every order sent and with its final state. */
  onOrder: (record: {
    intent: OrderIntent;
    attempt: number;
    order: BrokerOrder;
    submittedAt: number;
    quote?: OptionQuoteSnapshot;
  }) => void;
};

export type WorkOptions = {
  /** Hold the order until then, e.g. the open, since options only trade in regular hours. */
  notBefore?: number;
  /** Entries: true cancels the order now (shutting down). */
  abort?: () => boolean;
  /** Exits: true skips the remaining limit steps and goes to market (shutting down, data gone stale). */
  urgent?: () => boolean;
  /** Latest quote for the order's symbol, for pricing reprices and for the record. */
  quote?: () => OptionQuoteSnapshot | undefined;
};

/**
 * Works one engine order intent to a final result, which it reports in the engine's terms: one
 * `OrderUpdate` under the intent's id, with fills added up across every broker order it took.
 *
 * - Entries: one limit order at the engine's ask plus a small cushion. Whatever hasn't filled by
 *   the timeout is canceled; a partial fill opens a smaller position.
 * - Exits: a limit at the engine's bid, stepped down a tick at a time (and never above the latest
 *   bid), then a market order. Partial fills are reported as `partiallyFilled` along the way. If
 *   the chain still ends short, the engine reopens the rest and asks again on its next event.
 */
export class OrderWorker {
  private readonly deps: OrderWorkerDeps;

  constructor(deps: OrderWorkerDeps) {
    this.deps = deps;
  }

  async work(
    intent: OrderIntent,
    report: (update: OrderUpdate) => Promise<void>,
    options: WorkOptions = {},
  ): Promise<OrderUpdate> {
    const ready = await this.waitUntil(options.notBefore, options.abort);
    if (!ready) return this.finish(intent, report, 'canceled', 0, 0);
    return intent.action === 'open'
      ? this.enter(intent, report, options)
      : this.exit(intent, report, options);
  }

  private async enter(
    intent: OrderIntent,
    report: (update: OrderUpdate) => Promise<void>,
    options: WorkOptions,
  ): Promise<OrderUpdate> {
    const { settings } = this.deps;
    if (options.abort?.()) return this.finish(intent, report, 'canceled', 0, 0);

    const limitPrice = roundUp(
      intent.refPrice + settings.entryCushion,
      settings.tick,
    );
    const placed = await this.place(
      intent,
      0,
      {
        type: 'limit',
        qty: intent.qty,
        limitPrice,
      },
      options,
    );
    if (!placed) return this.finish(intent, report, 'rejected', 0, 0);

    let order = await this.awaitFinal(
      placed,
      settings.entryTimeoutMs,
      options.abort,
    );
    if (!isFinal(order)) order = await this.cancel(order);
    this.settled(intent, 0, order, placed.updatedAt);
    if (!isFinal(order)) this.unsettled(intent, order);

    const status: OrderUpdate['status'] =
      order.filledQty >= intent.qty ? 'filled' : endStatus(order);
    return this.finish(
      intent,
      report,
      status,
      order.filledQty,
      order.filledAvgPrice ?? 0,
    );
  }

  private async exit(
    intent: OrderIntent,
    report: (update: OrderUpdate) => Promise<void>,
    options: WorkOptions,
  ): Promise<OrderUpdate> {
    const { settings, timers } = this.deps;
    let filled = 0;
    let notional = 0;
    let steps = 0;
    let limit = roundDown(intent.refPrice, settings.tick);

    for (
      let attempt = 0;
      attempt < settings.exitMaxOrders && filled < intent.qty;
      attempt++
    ) {
      const market =
        Boolean(options.urgent?.()) ||
        steps > settings.exitMaxSteps ||
        !(limit > 0);
      const qty = intent.qty - filled;
      const placed = await this.place(
        intent,
        attempt,
        market
          ? { type: 'market', qty }
          : { type: 'limit', qty, limitPrice: limit },
        options,
      );
      if (!placed) {
        // A refused market order won't do better next time; a refused limit goes to market.
        if (market) break;
        steps = settings.exitMaxSteps + 1;
        continue;
      }

      let order = await this.awaitFinal(
        placed,
        market ? settings.cancelWaitMs : settings.exitStepMs,
        market ? undefined : options.urgent,
      );
      if (!isFinal(order)) order = await this.cancel(order);
      this.settled(intent, attempt, order, placed.updatedAt);

      filled += order.filledQty;
      notional += order.filledQty * (order.filledAvgPrice ?? 0);
      if (filled > 0 && filled < intent.qty) {
        await report({
          orderId: intent.id,
          status: 'partiallyFilled',
          filledQty: filled,
          avgFillPrice: notional / filled,
          time: timers.now(),
        });
      }
      if (!isFinal(order)) {
        // Still live at the broker: sending another could sell contracts twice.
        this.unsettled(intent, order);
        break;
      }

      steps += 1;
      const next = roundDown(
        limit - settings.exitStepTicks * settings.tick,
        settings.tick,
      );
      const bid = options.quote?.()?.bid;
      limit =
        bid !== undefined && bid > 0
          ? Math.min(next, roundDown(bid, settings.tick))
          : next;
    }

    const status: OrderUpdate['status'] =
      filled >= intent.qty ? 'filled' : 'canceled';
    return this.finish(
      intent,
      report,
      status,
      filled,
      filled > 0 ? notional / filled : 0,
    );
  }

  private async place(
    intent: OrderIntent,
    attempt: number,
    order: Pick<BrokerOrderRequest, 'type' | 'qty' | 'limitPrice'>,
    options: WorkOptions,
  ): Promise<BrokerOrder | undefined> {
    const { broker, tracker, timers, log, onOrder } = this.deps;
    const clientOrderId = attempt === 0 ? intent.id : `${intent.id}-${attempt}`;
    const request: BrokerOrderRequest = {
      clientOrderId,
      symbol: intent.symbol,
      side: intent.side,
      ...order,
    };
    const submittedAt = timers.now();
    const quote = options.quote?.();
    try {
      const placed = await broker.submitOrder(request);
      tracker.update(placed);
      log.info('order sent', {
        intentId: intent.id,
        attempt,
        ...request,
        quote,
      });
      onOrder({
        intent,
        attempt,
        order: tracker.get(clientOrderId) ?? placed,
        submittedAt,
        quote,
      });
      return tracker.get(clientOrderId) ?? placed;
    } catch (error) {
      const rejected = error instanceof OrderRejectedError;
      log[rejected ? 'warn' : 'error']('order not accepted', {
        intentId: intent.id,
        attempt,
        ...request,
        error: String(error),
      });
      onOrder({
        intent,
        attempt,
        submittedAt,
        quote,
        order: {
          id: '',
          clientOrderId,
          symbol: intent.symbol,
          side: intent.side,
          type: order.type,
          qty: order.qty,
          limitPrice: order.limitPrice ?? null,
          status: 'rejected',
          filledQty: 0,
          filledAvgPrice: null,
          updatedAt: submittedAt,
          raw: { error: String(error) },
        },
      });
      return undefined;
    }
  }

  /** Waits for the order to finish, polling the broker whenever the stream goes quiet. */
  private async awaitFinal(
    order: BrokerOrder,
    timeoutMs: number,
    stopEarly?: () => boolean,
  ): Promise<BrokerOrder> {
    const { tracker, timers, broker, settings, log } = this.deps;
    const id = order.clientOrderId;
    const deadline = timers.now() + timeoutMs;
    let latest = tracker.get(id) ?? order;
    while (!isFinal(latest) && timers.now() < deadline && !stopEarly?.()) {
      const before = latest;
      await tracker.waitForChange(
        id,
        Math.min(settings.orderPollMs, deadline - timers.now()),
        timers,
      );
      latest = tracker.get(id) ?? latest;
      if (latest === before && !isFinal(latest)) {
        try {
          tracker.update(await broker.getOrder(order.id));
          latest = tracker.get(id) ?? latest;
        } catch (error) {
          log.warn('order poll failed', {
            clientOrderId: id,
            error: String(error),
          });
        }
      }
    }
    return latest;
  }

  private async cancel(order: BrokerOrder): Promise<BrokerOrder> {
    const { broker, log, settings, tracker } = this.deps;
    try {
      await broker.cancelOrder(order.id);
    } catch (error) {
      // Usually it filled or was already canceled; the status poll below says which.
      log.info('cancel not accepted', {
        clientOrderId: order.clientOrderId,
        error: String(error),
      });
    }
    return this.awaitFinal(
      tracker.get(order.clientOrderId) ?? order,
      settings.cancelWaitMs,
    );
  }

  /** Records where an order ended up, once it's done or given up on. */
  private settled(
    intent: OrderIntent,
    attempt: number,
    order: BrokerOrder,
    submittedAt: number,
  ): void {
    this.deps.onOrder({ intent, attempt, order, submittedAt });
  }

  private unsettled(intent: OrderIntent, order: BrokerOrder): void {
    this.deps.log.error(
      'order still live after cancel; reconciliation will pick it up',
      {
        intentId: intent.id,
        clientOrderId: order.clientOrderId,
        status: order.status,
        filledQty: order.filledQty,
      },
    );
  }

  private async waitUntil(
    time: number | undefined,
    abort?: () => boolean,
  ): Promise<boolean> {
    const { timers } = this.deps;
    while (time !== undefined && timers.now() < time) {
      if (abort?.()) return false;
      await timers.sleep(Math.min(30_000, time - timers.now()));
    }
    return !abort?.();
  }

  private async finish(
    intent: OrderIntent,
    report: (update: OrderUpdate) => Promise<void>,
    status: OrderUpdate['status'],
    filledQty: number,
    avgFillPrice: number,
  ): Promise<OrderUpdate> {
    const update: OrderUpdate = {
      orderId: intent.id,
      status,
      filledQty,
      avgFillPrice,
      time: this.deps.timers.now(),
    };
    this.deps.log.info('order settled', {
      intentId: intent.id,
      action: intent.action,
      ...update,
    });
    await report(update);
    return update;
  }
}

function endStatus(order: BrokerOrder): OrderUpdate['status'] {
  if (order.status === 'rejected') return 'rejected';
  if (order.status === 'expired') return 'expired';
  return 'canceled';
}

const decimalsOf = (tick: number): number =>
  Math.max(0, Math.ceil(-Math.log10(tick)));

export const roundUp = (price: number, tick: number): number =>
  Number((Math.ceil(price / tick - 1e-9) * tick).toFixed(decimalsOf(tick)));

export const roundDown = (price: number, tick: number): number =>
  Number((Math.floor(price / tick + 1e-9) * tick).toFixed(decimalsOf(tick)));
