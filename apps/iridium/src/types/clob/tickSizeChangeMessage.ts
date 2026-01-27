export type TickSizeChangeMessage = {
  event_type: 'tick_size_change';
  asset_id: string;
  market: string;
  old_tick_size: string;
  new_tick_size: string;
  /** unix timestamp in ms */
  timestamp: string;
};
