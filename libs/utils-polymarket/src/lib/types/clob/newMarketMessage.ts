import { EventMessage } from './eventMessage';

export type NewMarketMessage = {
  event_type: 'new_market';
  id: string;
  question: string;
  market: string;
  slug: string;
  description: string;
  assets_ids: string[];
  outcomes: string[];
  event_message: EventMessage;
  /** unix timestamp in ms */
  timestamp: string;
};
