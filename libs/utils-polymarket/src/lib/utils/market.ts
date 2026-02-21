import { Market, OrderSummary } from '../types';

export function getTimeRemainingMs(market: Market, now: number = Date.now()) {
  return market.endDate.getTime() - now;
}

export function isExpired(market: Market, now: number = Date.now()) {
  return getTimeRemainingMs(market, now) <= 0;
}

/** @returns [price, size] */
export function parseOrderSummary(orderSummary: OrderSummary): [number, number] {
  return [parseFloat(orderSummary.price), parseFloat(orderSummary.size)];
}
