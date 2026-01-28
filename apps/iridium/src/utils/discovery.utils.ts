import { OrderSummary } from '../types/clob/bookMessage';
import { Market } from '../types/market';

export function getTimeRemaining(market: Market, now: Date = new Date()) {
  return market.endDate.getTime() - now.getTime();
}

/** @returns [price, size] */
export function parseOrderSummary(orderSummary: OrderSummary): [number, number] {
  return [parseFloat(orderSummary.price), parseFloat(orderSummary.size)];
}
