import { BrokerOrder, isFinal, Timers } from './ports';

/**
 * The latest known state of each order, by client order id, fed by the trade-update stream and by
 * polling. Fill quantities only ever go up, so an older report never undoes a newer one.
 */
export class OrderTracker {
  private readonly orders = new Map<string, BrokerOrder>();
  private readonly waiters = new Map<string, Set<() => void>>();

  get(clientOrderId: string): BrokerOrder | undefined {
    return this.orders.get(clientOrderId);
  }

  update(order: BrokerOrder): void {
    const known = this.orders.get(order.clientOrderId);
    if (known && isStale(known, order)) return;
    this.orders.set(order.clientOrderId, order);
    const waiting = this.waiters.get(order.clientOrderId);
    if (!waiting) return;
    this.waiters.delete(order.clientOrderId);
    for (const wake of waiting) wake();
  }

  /** Resolves on the next update to the order, or after `timeoutMs`. */
  async waitForChange(
    clientOrderId: string,
    timeoutMs: number,
    timers: Timers,
  ): Promise<void> {
    let wake: () => void = () => undefined;
    const changed = new Promise<void>((resolve) => {
      wake = resolve;
    });
    let set = this.waiters.get(clientOrderId);
    if (!set) {
      set = new Set();
      this.waiters.set(clientOrderId, set);
    }
    set.add(wake);
    try {
      await Promise.race([changed, timers.sleep(timeoutMs)]);
    } finally {
      this.waiters.get(clientOrderId)?.delete(wake);
    }
  }
}

/** True when `incoming` would move the order backwards. */
function isStale(known: BrokerOrder, incoming: BrokerOrder): boolean {
  if (incoming.filledQty < known.filledQty) return true;
  if (isFinal(known) && !isFinal(incoming)) return true;
  return false;
}
