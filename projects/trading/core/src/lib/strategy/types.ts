import { SessionHours } from '../market/calendar';
import { Bar, OptionContract, OptionType } from '../market/types';

/** Which way a signal expects the underlying to move. Bullish buys calls, bearish buys puts. */
export type Direction = 'bullish' | 'bearish';

export const optionTypeFor = (direction: Direction): OptionType =>
  direction === 'bullish' ? 'call' : 'put';

/** Latest value of each configured indicator, keyed by the name given in the config. */
export type IndicatorValues = Readonly<Record<string, number | undefined>>;

/** When something happened, in New York terms. */
export type Clock = {
  time: number;
  /** New York date, `YYYY-MM-DD`. */
  date: string;
  /** Minutes since New York midnight, fractional. */
  minute: number;
  /** That day's regular session, or null when the market is closed. */
  hours: SessionHours | null;
};

/** The timeframe bar that just closed on a ticker, with everything computed from it. */
export type BarSnapshot = {
  bar: Bar;
  /** Counts timeframe bars on this ticker, starting at 0. Keeps counting across days. */
  index: number;
  indicators: IndicatorValues;
  signal: Direction | null;
};

/** `opening` and `closing` mean an order was sent and its fill hasn't been reported yet. */
export type PositionStatus = 'opening' | 'open' | 'closing';

export type Position = {
  id: string;
  ticker: string;
  direction: Direction;
  contract: OptionContract;
  status: PositionStatus;
  qty: number;
  /** Average fill price per share. Until the entry fills, the ask the order was sized from. */
  entryPrice: number;
  entryTime: number;
  /** New York date of the entry. */
  entryDate: string;
  /** Index of the timeframe bar whose signal opened the position. */
  entryBarIndex: number;
  /** Latest option price, per the config's `markPrice`. */
  mark: number;
  /** Highest mark seen since the entry filled. */
  peakMark: number;
  bid?: number;
  ask?: number;
  /**
   * The underlying's price and the indicator values on the bar whose signal opened the position,
   * for exits measured on the underlying (a stop at the box low, a target at 3R).
   */
  atEntry?: { underlyingPrice: number; indicators: IndicatorValues };
};

/**
 * Profit or loss as a fraction of what was paid: 0.25 is up 25%, -0.3 is down 30%.
 * Every position is a bought option, so a falling premium is always a loss, for puts as well as calls.
 */
export const pnlPct = (entryPrice: number, price: number): number =>
  (price - entryPrice) / entryPrice;

export const positionPnlPct = (position: Position): number =>
  pnlPct(position.entryPrice, position.mark);
