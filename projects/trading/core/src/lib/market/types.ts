/** A closed OHLCV candle. `time` is when the bar started, in epoch milliseconds. */
export type Bar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OptionType = 'call' | 'put';

/** One contract from an option chain, with its quote at the moment the chain was read. */
export type OptionContract = {
  /** OCC symbol, e.g. `SPY261116C00590000`. */
  symbol: string;
  underlying: string;
  type: OptionType;
  strike: number;
  /** Expiration date in New York, `YYYY-MM-DD`. */
  expiration: string;
  bid: number;
  ask: number;
  openInterest?: number;
  /** Shares per contract. Treated as 100 when absent. */
  multiplier?: number;
};

/** A quote update for one option contract. */
export type OptionQuote = {
  symbol: string;
  time: number;
  bid: number;
  ask: number;
  last?: number;
};

export const DEFAULT_MULTIPLIER = 100;

export const multiplierOf = (contract: OptionContract): number =>
  contract.multiplier ?? DEFAULT_MULTIPLIER;
