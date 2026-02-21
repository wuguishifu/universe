export type OrderMessage = {
  event_type: 'order';
  asset_id: string;
  associate_trades: string[] | null;
  id: string;
  /** condition ID */
  market: string;
  order_owner: string;
  original_size: string;
  outcome: string;
  price: string;
  side: 'BUY' | 'SELL';
  size_matched: string;
  timestamp: string;
  type: 'PLACEMENT' | 'UPDATE' | 'CANCELLATION';
};
