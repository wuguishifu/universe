import { ExitReason } from '../exits/exit-rule';
import { OptionContract, OptionType } from '../market/types';
import { BarSnapshot, Direction, Position } from '../strategy/types';

export type ChainRequest = {
  underlying: string;
  type: OptionType;
  time: number;
  /** Close of the bar that produced the signal. Useful for fetching only nearby strikes. */
  underlyingPrice: number;
};

/**
 * Supplies option chains with current quotes. The live bot reads them from the broker; the
 * backtester builds them from historical data as of `request.time`.
 */
export interface ChainProvider {
  getChain(request: ChainRequest): Promise<readonly OptionContract[]>;
}

/** An order the host should place. Its `id` should be sent as the broker's client order id. */
export type OrderIntent = {
  id: string;
  /** `open` buys to open a position, `close` sells to close one. */
  action: 'open' | 'close';
  positionId: string;
  ticker: string;
  /** Option symbol. */
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  /** The ask when buying, the bid when selling, at decision time. A guide for limit prices. */
  refPrice: number;
  time: number;
  /** Set on `close` orders. */
  reason?: ExitReason;
};

/**
 * The broker's report on an order, as cumulative totals (the way Alpaca's trade updates arrive).
 * Partial fills are ignored until the order reaches a final status.
 */
export type OrderUpdate = {
  orderId: string;
  status: 'partiallyFilled' | 'filled' | 'canceled' | 'rejected' | 'expired';
  /** Total contracts filled so far. */
  filledQty: number;
  /** Average price per share of everything filled so far. */
  avgFillPrice: number;
  time: number;
};

/** Contracts bought and sold again. Fees are not included. */
export type Trade = {
  positionId: string;
  ticker: string;
  direction: Direction;
  symbol: string;
  qty: number;
  multiplier: number;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  reason: ExitReason;
  /** Dollars. */
  pnl: number;
  /** Fraction of the premium paid. */
  pnlPct: number;
};

export type EngineEvent =
  /** A timeframe bar closed. Handy for charting what the strategy saw. */
  | { type: 'bar'; ticker: string; snapshot: BarSnapshot }
  | { type: 'signal'; ticker: string; direction: Direction; time: number }
  | {
      type: 'entrySkipped';
      ticker: string;
      direction: Direction;
      time: number;
      reason: string;
    }
  | { type: 'order'; order: OrderIntent }
  | { type: 'positionOpened'; position: Position }
  /** An entry order ended without any fills. */
  | {
      type: 'entryFailed';
      ticker: string;
      orderId: string;
      status: OrderUpdate['status'];
    }
  | { type: 'positionClosed'; trade: Trade }
  /**
   * An exit order ended with contracts still held. The position is open again and its exit
   * rules will fire again on the next event. `trade` covers any contracts that did sell.
   */
  | {
      type: 'exitFailed';
      ticker: string;
      orderId: string;
      status: OrderUpdate['status'];
      trade?: Trade;
    };
