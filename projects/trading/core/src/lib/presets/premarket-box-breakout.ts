import { StrategyConfigInput } from '../config/strategy-config';

/**
 * The pre-market box breakout (research H17, in QQQ options as H18 config B).
 *
 * - Box: the high and low of 09:00–09:30, from pre-market bars.
 * - Entry: the first 5-minute bar from 09:30 that closes outside the box, if one does by 10:30.
 *   Only one per day: when it points against the trend filter, there's no trade that day.
 * - Trend filter: calls only while the 15-minute EMA50 is above the EMA200 (04:00–20:00 bars),
 *   puts only while it's below.
 * - Contract: the at-the-money option of the first expiration after today.
 * - Exits, all measured on the underlying: the far side of the box (stop), 3× the entry-to-stop
 *   distance (target), or 15:55.
 *
 * The EMA200 runs on 15-minute bars, so it needs about 10 trading days of extended-hours
 * 1-minute bars through `warmup` before the first live day.
 *
 * To trade same-day expirations instead (H18 config A), override
 * `contract: { expiry: { type: 'nearest', minDte: 0 }, strike: { type: 'atm' } }`.
 */
export const PREMARKET_BOX_BREAKOUT = {
  tickers: ['QQQ'],
  timeframeMinutes: 5,
  session: 'extended',
  indicators: {
    boxHigh: { type: 'timeRange', side: 'high', start: '09:00', end: '09:30' },
    boxLow: { type: 'timeRange', side: 'low', start: '09:00', end: '09:30' },
    ema50: { type: 'ema', length: 50, timeframeMinutes: 15 },
    ema200: { type: 'ema', length: 200, timeframeMinutes: 15 },
  },
  signal: {
    type: 'breakout',
    upper: 'boxHigh',
    lower: 'boxLow',
    source: 'close',
    maxPerSession: 1,
  },
  entryFilters: [
    { type: 'timeWindow', latestAfterOpenMinutes: 60 },
    { type: 'indicatorSide', fast: 'ema50', slow: 'ema200' },
    { type: 'maxEntriesPerDay', count: 1 },
  ],
  exits: [
    { type: 'flatBeforeClose', minutes: 5 },
    {
      type: 'underlyingStop',
      indicator: 'boxLow',
      bearishIndicator: 'boxHigh',
    },
    {
      type: 'underlyingTarget',
      stopIndicator: 'boxLow',
      bearishStopIndicator: 'boxHigh',
      rMultiple: 3,
    },
  ],
  contract: {
    expiry: { type: 'nearest', minDte: 1 },
    strike: { type: 'atm' },
  },
  sizing: { type: 'contracts', count: 1 },
  risk: [{ type: 'maxPositions', count: 1 }],
  markPrice: 'mid',
} satisfies StrategyConfigInput;
