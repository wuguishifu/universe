/** [price, size] */
export type OrderSide = [number, number][];
export type OrderBook = { asks: OrderSide; bids: OrderSide };
