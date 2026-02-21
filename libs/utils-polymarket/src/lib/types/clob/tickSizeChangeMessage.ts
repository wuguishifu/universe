import { TickSize } from '@polymarket/clob-client';

export type TickSizeChangeMessage = {
  event_type: 'tick_size_change';
  asset_id: string;
  market: string;
  old_tick_size: TickSize;
  new_tick_size: TickSize;
  /** unix timestamp in ms */
  timestamp: string;
};
