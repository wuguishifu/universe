export type BestBidAskMessage = {
  event_type: 'best_bid_ask';
  market: string;
  asset_id: string;
  best_bid: string;
  best_ask: string;
  spread: string;
  /** unix timestamp in ms */
  timestamp: string;
};
