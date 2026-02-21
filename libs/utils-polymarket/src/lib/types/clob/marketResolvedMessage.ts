import { EventMessage } from './eventMessage';

export type MarketResolvedMessage = {
  event_type: 'market_resolved';
  question: string;
  market: string;
  slug: string;
  description: string;
  assets_ids: string[];
  outcomes: string[];
  winning_asset_id: string;
  winning_outcome: string;
  event_message: EventMessage;
  /** unix timestamp in ms */
  timestamp: string;
};
