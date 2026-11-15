import {
  DEFAULT_MULTIPLIER,
  OrderIntent,
  OrderUpdate,
  Position,
  multiplierOf,
} from '@projects/trading-core';

import { modelQuote, roundToCent } from './quotes';
import { SimulationConfig } from './simulation-config';

/** An option trade price and when it happened. */
export type MarketPrice = { price: number; time: number };

/**
 * Fills orders at the modeled ask when buying or bid when selling, plus slippage, rounded to the
 * cent against the trader. With `fillAt: 'nextTrade'` the quote is built around `market`, the first
 * trade at or after the order; with `'decision'` it's the price the engine saw.
 */
export class SimulatedBroker {
  private readonly simulation: SimulationConfig;
  private cashBalance: number;
  private feesPaid = 0;

  constructor(simulation: SimulationConfig) {
    this.simulation = simulation;
    this.cashBalance = simulation.startingCash;
  }

  get cash(): number {
    return this.cashBalance;
  }

  get fees(): number {
    return this.feesPaid;
  }

  fill(
    order: OrderIntent,
    multiplier = DEFAULT_MULTIPLIER,
    market?: MarketPrice,
  ): OrderUpdate {
    let base = order.refPrice;
    let time = order.time;
    if (this.simulation.fillAt === 'nextTrade') {
      if (!market) {
        return {
          orderId: order.id,
          status: 'rejected',
          filledQty: 0,
          avgFillPrice: 0,
          time,
        };
      }
      const quote = modelQuote(market.price, this.simulation);
      base = order.side === 'buy' ? quote.ask : quote.bid;
      time = market.time;
    }

    const slip = this.simulation.slippagePct;
    const raw = order.side === 'buy' ? base * (1 + slip) : base * (1 - slip);
    const price = roundToCent(raw, order.side);
    const notional = price * order.qty * multiplier;
    const fee = this.simulation.feePerContract * order.qty;

    this.cashBalance += order.side === 'buy' ? -notional - fee : notional - fee;
    this.feesPaid += fee;
    return {
      orderId: order.id,
      status: 'filled',
      filledQty: order.qty,
      avgFillPrice: price,
      time,
    };
  }

  /** Cash plus open positions at their latest marks. */
  equity(positions: readonly Position[]): number {
    let value = this.cashBalance;
    for (const position of positions) {
      if (position.status === 'opening') continue;
      value += position.qty * position.mark * multiplierOf(position.contract);
    }
    return value;
  }
}
