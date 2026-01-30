import { OrderBook } from './order-book';

type PositionYes = {
  yesShares: number;
  averageYesPrice: number;
  noShares: undefined;
  averageNoPrice: undefined;
};

type PositionNo = {
  yesShares: undefined;
  averageYesPrice: undefined;
  noShares: number;
  averageNoPrice: number;
};

type PositionFilled = {
  yesShares: number;
  noShares: number;
  averageYesPrice: number;
  averageNoPrice: number;
};

export type Straddle = {
  position?: PositionYes | PositionNo | PositionFilled;
  yesBook?: OrderBook;
  noBook?: OrderBook;
  createdAtMs: number;
  lastTradeAtMs?: number;
};
