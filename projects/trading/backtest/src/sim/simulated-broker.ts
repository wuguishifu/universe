import {
  DEFAULT_MULTIPLIER,
  OrderIntent,
  OrderUpdate,
  Position,
  multiplierOf,
} from '@projects/trading-core';

import { roundToCent } from './quotes';
import { SimulationConfig } from './simulation-config';

/**
 * Fills every order immediately at the price the engine saw when it decided (the modeled ask
 * when buying, the bid when selling), plus slippage, rounded to the cent against the trader.
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

  fill(order: OrderIntent, multiplier = DEFAULT_MULTIPLIER): OrderUpdate {
    const slip = this.simulation.slippagePct;
    const raw =
      order.side === 'buy'
        ? order.refPrice * (1 + slip)
        : order.refPrice * (1 - slip);
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
      time: order.time,
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
