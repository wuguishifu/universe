export type OrderSummary = {
  price: string;
  size: string;
};

export type BookMessage = {
  event_type: 'book';
  asset_id: string;
  market: string;
  /** unix timestamp in ms */
  timestamp: string;
  hash: string;
  buys: OrderSummary[];
  sells: OrderSummary[];
};
