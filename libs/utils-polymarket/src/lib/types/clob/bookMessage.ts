export type OrderSummary = {
  price: string;
  size: string;
};

export type BookMessage = {
  event_type: 'book';
  asset_id: string;
  /** condition ID */
  market: string;
  /** unix timestamp in ms */
  timestamp: string;
  hash: string;
  bids: OrderSummary[];
  asks: OrderSummary[];
};
