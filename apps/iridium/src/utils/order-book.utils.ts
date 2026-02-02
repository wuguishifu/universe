import { OrderBook } from '../types/order-book';

export function getBestPrice(orderBook: OrderBook | undefined): number | undefined {
  return orderBook?.asks[0]?.[0];
}

export function getBestBid(orderBook: OrderBook | undefined): number | undefined {
  return orderBook?.bids[0]?.[0];
}

export function getMidPrice(orderBook: OrderBook): number | undefined {
  const bestAsk = getBestPrice(orderBook);
  const bestBid = getBestBid(orderBook);
  return bestAsk && bestBid ? (bestAsk + bestBid) / 2 : undefined;
}

export function getSpread(orderBook: OrderBook): number | undefined {
  const bestAsk = getBestPrice(orderBook);
  const bestBid = getBestBid(orderBook);
  return bestAsk && bestBid ? bestAsk - bestBid : undefined;
}

export function getSpreadRatio(orderBook: OrderBook): number | undefined {
  const bestAsk = getBestPrice(orderBook);
  const bestBid = getBestBid(orderBook);
  return bestAsk && bestBid ? (bestAsk - bestBid) / ((bestAsk + bestBid) / 2) : undefined;
}

export function getDepth(orderBook: OrderBook): number {
  return orderBook.asks.reduce((sum, [price, size]) => sum + price * size, 0);
}
