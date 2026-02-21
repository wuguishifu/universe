export type PriceChange = {
  asset_id: string;
  price: string;
  size: string;
  side: string;
  hash: string;
  best_bid: string;
  best_ask: string;
};

export type PriceChangeMessage = {
  event_type: 'price_change';
  market: string;
  price_changes: PriceChange[];
  /** unix timestamp in ms */
  timestamp: string;
};
