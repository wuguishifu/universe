import { EngineEvent } from '@projects/trading-core';

import { BacktestResult, BacktestTrade } from '../sim/backtest';

export type Breakdown = { trades: number; netPnl: number; winRate: number };

export type BacktestStats = {
  startingCash: number;
  endingEquity: number;
  netPnl: number;
  returnPct: number;
  fees: number;

  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  /** Gross wins over gross losses. Infinity with no losing trades. */
  profitFactor: number;
  /** Average net P&L per trade, in dollars. */
  expectancy: number;
  /** Average P&L per trade as a fraction of premium paid. */
  avgPnlPct: number;

  /** Largest fall from a peak in equity, in dollars, and as a fraction of that peak. */
  maxDrawdown: number;
  maxDrawdownPct: number;

  tradingDays: number;
  winningDays: number;
  losingDays: number;
  bestDay: number;
  worstDay: number;

  byReason: Record<string, Breakdown>;
  byDirection: Record<string, Breakdown>;
  signals: number;
  /** Why signals didn't become trades, with contract symbols and dates stripped so they group. */
  skipped: Record<string, number>;
};

const sum = (values: readonly number[]): number =>
  values.reduce((a, b) => a + b, 0);
const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : sum(values) / values.length;

function breakdown(
  trades: readonly BacktestTrade[],
  key: (t: BacktestTrade) => string,
) {
  const groups: Record<string, BacktestTrade[]> = {};
  for (const trade of trades) (groups[key(trade)] ??= []).push(trade);
  const result: Record<string, Breakdown> = {};
  for (const [name, group] of Object.entries(groups)) {
    result[name] = {
      trades: group.length,
      netPnl: sum(group.map((t) => t.netPnl)),
      winRate: group.filter((t) => t.netPnl > 0).length / group.length,
    };
  }
  return result;
}

export const normalizeSkipReason = (reason: string): string =>
  reason
    .replace(/^\S+ rejected by /, 'contract rejected by ')
    .replace(/^\S+ has no ask$/, 'contract has no ask')
    .replace(/ on \d{4}-\d{2}-\d{2}$/, '');

function countSkips(events: readonly EngineEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    if (event.type !== 'entrySkipped') continue;
    const reason = normalizeSkipReason(event.reason);
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

export function computeStats(result: BacktestResult): BacktestStats {
  const { trades, simulation, days } = result;
  const startingCash = simulation.startingCash;
  const endingEquity = result.equity.at(-1)?.equity ?? startingCash;

  const wins = trades.filter((t) => t.netPnl > 0).map((t) => t.netPnl);
  const losses = trades.filter((t) => t.netPnl <= 0).map((t) => t.netPnl);
  const grossLoss = -sum(losses);

  let peak = startingCash;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const { equity } of result.equity) {
    peak = Math.max(peak, equity);
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPct = drawdown / peak;
    }
  }

  const dayPnls = days.map((day) => day.netPnl);
  return {
    startingCash,
    endingEquity,
    netPnl: endingEquity - startingCash,
    returnPct: (endingEquity - startingCash) / startingCash,
    fees: sum(trades.map((t) => t.fees)),

    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length === 0 ? 0 : wins.length / trades.length,
    avgWin: mean(wins),
    avgLoss: mean(losses),
    largestWin: Math.max(0, ...wins),
    largestLoss: Math.min(0, ...losses),
    profitFactor:
      grossLoss === 0 ? (wins.length ? Infinity : 0) : sum(wins) / grossLoss,
    expectancy: mean(trades.map((t) => t.netPnl)),
    avgPnlPct: mean(trades.map((t) => t.pnlPct)),

    maxDrawdown,
    maxDrawdownPct,

    tradingDays: days.length,
    winningDays: dayPnls.filter((p) => p > 0).length,
    losingDays: dayPnls.filter((p) => p < 0).length,
    bestDay: Math.max(0, ...dayPnls),
    worstDay: Math.min(0, ...dayPnls),

    byReason: breakdown(trades, (t) => t.reason),
    byDirection: breakdown(trades, (t) => t.direction),
    signals: result.events.filter((e) => e.type === 'signal').length,
    skipped: countSkips(result.events),
  };
}
