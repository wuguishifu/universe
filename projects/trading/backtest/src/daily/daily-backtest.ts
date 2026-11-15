import {
  AllocationConfig,
  allocationTickers,
  isMonthEnd,
  PriceHistory,
  targetWeights,
  Weights,
} from '@projects/trading-core';

import { DailyBar } from '../data/data-store';

/** Daily prices for many tickers on the same dates. */
export type DailySeries = {
  dates: string[];
  open: Record<string, number[]>;
  close: Record<string, number[]>;
  /** Dates dropped because some ticker had no bar that day. */
  dropped: string[];
};

/**
 * Lines tickers up on the dates they all traded, starting from the latest first bar among them.
 * A date that some ticker is missing is dropped for all of them and listed in `dropped`.
 */
export function alignDaily(
  bars: Readonly<Record<string, readonly DailyBar[]>>,
): DailySeries {
  const byTicker: Array<[string, Map<string, DailyBar>]> = Object.entries(
    bars,
  ).map(([ticker, list]) => [
    ticker,
    new Map(list.map((bar) => [bar.date, bar])),
  ]);
  const start = byTicker
    .map(([, map]) => [...map.keys()].sort()[0] ?? '')
    .sort()
    .at(-1);
  const allDates = [...new Set(byTicker.flatMap(([, map]) => [...map.keys()]))]
    .filter((date) => start !== undefined && date >= start)
    .sort();

  const series: DailySeries = { dates: [], open: {}, close: {}, dropped: [] };
  for (const [ticker] of byTicker) {
    series.open[ticker] = [];
    series.close[ticker] = [];
  }
  for (const date of allDates) {
    if (!byTicker.every(([, map]) => map.has(date))) {
      series.dropped.push(date);
      continue;
    }
    series.dates.push(date);
    for (const [ticker, map] of byTicker) {
      const bar = map.get(date);
      if (!bar) continue;
      series.open[ticker]?.push(bar.open);
      series.close[ticker]?.push(bar.close);
    }
  }
  return series;
}

export type DailyRunOptions = {
  /** First and last date, `YYYY-MM-DD`, inclusive. Earlier data is used only as history. */
  from: string;
  to: string;
  startingCash: number;
  /** Cost of trading, in basis points of the value bought or sold. */
  costBps: number;
};

export type Rebalance = {
  /** The month-end whose close decided the weights. */
  decided: string;
  /** The next trading day, when the trades fill at the open. */
  traded: string;
  weights: Weights;
  /** Value bought plus value sold, as a fraction of equity. Swapping everything is 2. */
  turnover: number;
  cost: number;
};

export type EquityPoint = {
  date: string;
  /** Portfolio value at the close. */
  value: number;
  /** The cash ticker's return that day, for excess returns. */
  cashReturn: number;
};

export type DailyResult = {
  startingCash: number;
  /** One point per day from the first rebalance on. Empty if it never traded. */
  equity: EquityPoint[];
  rebalances: Rebalance[];
  costs: number;
  cash: string;
};

/**
 * Rebalances to `targetWeights` after every month-end close, filling at the next day's open with
 * fractional shares. The portfolio is marked at each close from the first rebalance on.
 */
export function runDaily(
  config: AllocationConfig,
  series: DailySeries,
  options: DailyRunOptions,
): DailyResult {
  const tickers = allocationTickers(config);
  const priceOf = (
    side: 'open' | 'close',
    ticker: string,
    i: number,
  ): number => {
    const price = series[side][ticker]?.[i];
    if (price === undefined) throw new Error(`No ${side} for ${ticker}`);
    return price;
  };
  for (const ticker of tickers) priceOf('close', ticker, 0);

  const result: DailyResult = {
    startingCash: options.startingCash,
    equity: [],
    rebalances: [],
    costs: 0,
    cash: config.cash,
  };
  let shares: Record<string, number> = {};
  let pending: { decided: string; weights: Weights } | undefined;

  const valueAt = (side: 'open' | 'close', i: number): number =>
    Object.entries(shares).reduce(
      (sum, [ticker, count]) => sum + count * priceOf(side, ticker, i),
      0,
    );

  const { dates } = series;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i] ?? '';
    if (date > options.to) break;

    if (pending) {
      const value =
        result.rebalances.length === 0
          ? options.startingCash
          : valueAt('open', i);
      let turnover = 0;
      for (const ticker of new Set([
        ...Object.keys(shares),
        ...Object.keys(pending.weights),
      ])) {
        const current = (shares[ticker] ?? 0) * priceOf('open', ticker, i);
        turnover += Math.abs((pending.weights[ticker] ?? 0) * value - current);
      }
      const cost = (turnover * options.costBps) / 10_000;
      const after = value - cost;
      shares = {};
      for (const [ticker, weight] of Object.entries(pending.weights)) {
        if (weight > 0)
          shares[ticker] = (weight * after) / priceOf('open', ticker, i);
      }
      result.rebalances.push({
        decided: pending.decided,
        traded: date,
        weights: pending.weights,
        turnover: turnover / value,
        cost,
      });
      result.costs += cost;
      pending = undefined;
    }

    if (result.rebalances.length > 0) {
      const cashClose = priceOf('close', config.cash, i);
      const cashBefore =
        result.equity.length === 0
          ? priceOf('open', config.cash, i)
          : priceOf('close', config.cash, i - 1);
      result.equity.push({
        date,
        value: valueAt('close', i),
        cashReturn: cashClose / cashBefore - 1,
      });
    }

    const next = dates[i + 1];
    if (
      date >= options.from &&
      isMonthEnd(date, next) &&
      next !== undefined &&
      next <= options.to
    ) {
      const history: PriceHistory = Object.fromEntries(
        tickers.map((ticker) => [
          ticker,
          (series.close[ticker] ?? []).slice(0, i + 1),
        ]),
      );
      const weights = targetWeights(config, history);
      if (weights) pending = { decided: date, weights };
    }
  }
  return result;
}
