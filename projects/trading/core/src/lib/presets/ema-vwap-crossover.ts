import { StrategyConfigInput } from '../config/strategy-config';

/**
 * Buys calls when EMA9 crosses above VWAP and puts when it crosses below.
 *
 * Exits: flat 10 minutes before the close, -30% premium stop, a 5-minute close through EMA9,
 * +50% profit target, or the opposite cross. A trailing stop is available but off; add
 * `{ type: 'trailingStop', pct: 0.2 }` to `exits` to try it.
 *
 * Spread over it to override, e.g. `{ ...EMA_VWAP_CROSSOVER, tickers: ['QQQ'] }`.
 */
export const EMA_VWAP_CROSSOVER = {
  tickers: ['SPY'],
  timeframeMinutes: 5,
  session: 'regular',
  indicators: {
    ema9: { type: 'ema', length: 9, source: 'close', warmup: 'carryOver' },
    vwap: { type: 'vwap', source: 'ohlc4' },
  },
  signal: { type: 'crossover', fast: 'ema9', slow: 'vwap' },
  entryFilters: [
    { type: 'timeWindow', startDelayMinutes: 15, endBeforeCloseMinutes: 30 },
    { type: 'cooldown', bars: 2, afterReasons: ['pnlStop', 'indicatorBreak'] },
  ],
  exits: [
    { type: 'flatBeforeClose', minutes: 10 },
    { type: 'pnlStop', pct: 0.3 },
    { type: 'indicatorBreak', indicator: 'ema9', trigger: 'close' },
    { type: 'profitTarget', pct: 0.5 },
    { type: 'oppositeSignal' },
  ],
  contract: {
    expiry: { type: 'nearest', minDte: 1 },
    strike: { type: 'atm' },
    filters: [{ type: 'maxSpreadPct', pct: 0.05 }],
  },
  sizing: { type: 'contracts', count: 1 },
  risk: [{ type: 'maxPositions', count: 3 }],
  markPrice: 'mid',
} satisfies StrategyConfigInput;
