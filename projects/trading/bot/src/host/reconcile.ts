import {
  Bar,
  Clock,
  createExitRule,
  ExitRuleConfig,
  MarketCalendar,
  nyTime,
  Position,
} from '@projects/trading-core';

import { parseOccSymbol } from './occ';
import { BrokerOrder, BrokerPosition, SavedPosition } from './ports';

export type Flatten = { symbol: string; qty: number; reason: string };

export type ReconcilePlan = {
  /** The bot's own orders left open by an earlier run. */
  cancel: BrokerOrder[];
  /** Positions to hand back to the engine. */
  restore: Position[];
  /** Positions to sell outside the engine. */
  flatten: Flatten[];
  /** Saved as open, but the broker no longer holds them. */
  gone: SavedPosition[];
  /** Not the bot's to touch: other underlyings, stock, shorts, orders it didn't send. */
  foreign: Array<BrokerPosition | BrokerOrder>;
};

export type ReconcileInput = {
  tickers: readonly string[];
  /** Every client order id the bot sends starts with this. */
  clientOrderPrefix: string;
  brokerPositions: readonly BrokerPosition[];
  openOrders: readonly BrokerOrder[];
  saved: readonly SavedPosition[];
};

/**
 * Decides, after a restart, what happens to whatever the broker still holds. A long option on one
 * of the strategy's tickers rejoins the engine if a saved position explains it (the broker's
 * quantity and average price win, since fills may have landed while the bot was down). Anything
 * the bot can't explain is flattened, and anything that isn't its kind of position is left alone.
 */
export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = {
    cancel: [],
    restore: [],
    flatten: [],
    gone: [],
    foreign: [],
  };

  for (const order of input.openOrders) {
    if (order.clientOrderId.startsWith(input.clientOrderPrefix))
      plan.cancel.push(order);
    else plan.foreign.push(order);
  }

  const savedBySymbol = new Map<string, SavedPosition[]>();
  for (const saved of input.saved) {
    const list = savedBySymbol.get(saved.position.contract.symbol) ?? [];
    list.push(saved);
    savedBySymbol.set(saved.position.contract.symbol, list);
  }

  const held = new Set<string>();
  for (const position of input.brokerPositions) {
    const occ = parseOccSymbol(position.symbol);
    const ours =
      position.assetClass === 'us_option' &&
      occ !== null &&
      input.tickers.includes(occ.underlying) &&
      position.qty > 0;
    if (!ours) {
      plan.foreign.push(position);
      continue;
    }
    held.add(position.symbol);
    // Newest first: if two runs saved the same contract, the latest one is the live one.
    const [saved] = (savedBySymbol.get(position.symbol) ?? []).sort(
      (a, b) => b.position.entryTime - a.position.entryTime,
    );
    if (!saved || !saved.position.atEntry) {
      plan.flatten.push({
        symbol: position.symbol,
        qty: position.qty,
        reason: saved
          ? 'saved position has no entry levels'
          : 'no saved position explains it',
      });
      continue;
    }
    plan.restore.push({
      ...saved.position,
      status: 'open',
      qty: position.qty,
      entryPrice: position.avgEntryPrice,
      mark: saved.position.mark || position.avgEntryPrice,
      peakMark: Math.max(saved.position.peakMark, position.avgEntryPrice),
    });
  }

  for (const saved of input.saved) {
    if (!held.has(saved.position.contract.symbol)) plan.gone.push(saved);
  }
  return plan;
}

/**
 * The first exit the strategy would have taken on bars it missed while down, judged the way the
 * engine judges 1-minute bars. Only the rules that look at the underlying's bars and the clock can
 * fire here; quote-driven ones need prices the bot never saw.
 */
export function missedExit(
  position: Position,
  bars: readonly Bar[],
  exits: readonly ExitRuleConfig[],
  calendar: MarketCalendar,
): { reason: string; bar: Bar } | undefined {
  const rules = exits.map(createExitRule);
  for (const bar of bars) {
    if (bar.time < position.entryTime) continue;
    const time = bar.time + 60_000;
    const { date, minute } = nyTime(time);
    const clock: Clock = {
      time,
      date,
      minute,
      hours: calendar.regularHours(date),
    };
    const rule = rules.find((r) =>
      r.shouldExit(position, { kind: 'clock', clock, bar }),
    );
    if (rule) return { reason: rule.reason, bar };
  }
  return undefined;
}
