export type LastTradePriceMessage = {
  event_type: 'last_trade_price';
  asset_id: string;
  free_rate_bps: string;
  market: string;
  price: string;
  side: 'BUY' | 'SELL';
  size: string;
  /** unix timestamp in ms */
  timestamp: string;
};
