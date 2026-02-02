import { BestBidAskMessage } from './bestBidAskMessage';
import { BookMessage } from './bookMessage';
import { LastTradePriceMessage } from './lastTradePriceMessage';
import { MarketResolvedMessage } from './marketResolvedMessage';
import { NewMarketMessage } from './newMarketMessage';
import { OrderMessage } from './orderMessage';
import { PriceChangeMessage } from './priceChangeMessage';
import { TickSizeChangeMessage } from './tickSizeChangeMessage';

export type Message =
  | BestBidAskMessage
  | BookMessage
  | LastTradePriceMessage
  | MarketResolvedMessage
  | NewMarketMessage
  | PriceChangeMessage
  | TickSizeChangeMessage
  | OrderMessage;
