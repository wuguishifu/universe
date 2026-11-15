import { BacktestResult } from '../sim/backtest';

export type Breakdown = {
  trades: number;
  netPnl: number;
  winRate: number;
  tStat: number;
};

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
  /**
   * Expectancy divided by its standard error. Roughly, |t| under 2 means the result can't be told
   * apart from luck. Before trusting a big t, remember how many configs were tried to find it.
   */
  tStat: number;
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
  byTicker: Record<string, Breakdown>;
  signals: number;
  /** Why signals didn't become trades, with contract symbols and dates stripped so they group. */
  skipped: Record<string, number>;
  /** Days that ended with a position still open. Every strategy here is flat overnight, so this should be 0. */
  daysLeftOpen: number;
};

type Tally = { trades: number; netPnl: number; wins: number; sumSq: number };

/**
 * Running totals for a stretch of time. Totals from back-to-back stretches merge exactly, so a
 * long range can be split across workers and recombined.
 */
export type StatsPartial = {
  trades: number;
  wins: number;
  sumWins: number;
  sumLosses: number;
  sumNetSq: number;
  sumPnlPct: number;
  largestWin: number;
  largestLoss: number;
  fees: number;
  byReason: Record<string, Tally>;
  byDirection: Record<string, Tally>;
  byTicker: Record<string, Tally>;

  days: number;
  winningDays: number;
  losingDays: number;
  bestDay: number;
  worstDay: number;

  /** Equity, relative to the start of the stretch: where it ended, its high and low points. */
  equityEnd: number;
  equityHigh: number;
  equityLow: number;
  /** The largest drawdown inside the stretch, and the relative peak it fell from. */
  maxDrawdown: number;
  maxDrawdownPeak: number;

  signals: number;
  skipped: Record<string, number>;
  daysLeftOpen: number;
};

export const normalizeSkipReason = (reason: string): string =>
  reason
    .replace(/^\S+ rejected by /, 'contract rejected by ')
    .replace(/^\S+ has no ask$/, 'contract has no ask')
    .replace(/ on \d{4}-\d{2}-\d{2}$/, '');

const tally = (tallies: Record<string, Tally>, key: string, netPnl: number) => {
  const entry = (tallies[key] ??= { trades: 0, netPnl: 0, wins: 0, sumSq: 0 });
  entry.trades += 1;
  entry.netPnl += netPnl;
  entry.sumSq += netPnl * netPnl;
  if (netPnl > 0) entry.wins += 1;
};

export function partialFromResult(result: BacktestResult): StatsPartial {
  const partial: StatsPartial = {
    trades: 0,
    wins: 0,
    sumWins: 0,
    sumLosses: 0,
    sumNetSq: 0,
    sumPnlPct: 0,
    largestWin: 0,
    largestLoss: 0,
    fees: 0,
    byReason: {},
    byDirection: {},
    byTicker: {},
    days: result.days.length,
    winningDays: 0,
    losingDays: 0,
    bestDay: 0,
    worstDay: 0,
    equityEnd: 0,
    equityHigh: 0,
    equityLow: 0,
    maxDrawdown: 0,
    maxDrawdownPeak: 0,
    signals: 0,
    skipped: {},
    daysLeftOpen: result.warnings.filter((w) => /still open after/.test(w))
      .length,
  };

  for (const trade of result.trades) {
    const net = trade.netPnl;
    partial.trades += 1;
    if (net > 0) {
      partial.wins += 1;
      partial.sumWins += net;
      partial.largestWin = Math.max(partial.largestWin, net);
    } else {
      partial.sumLosses += net;
      partial.largestLoss = Math.min(partial.largestLoss, net);
    }
    partial.sumNetSq += net * net;
    partial.sumPnlPct += trade.pnlPct;
    partial.fees += trade.fees;
    tally(partial.byReason, trade.reason, net);
    tally(partial.byDirection, trade.direction, net);
    tally(partial.byTicker, trade.ticker, net);
  }

  for (const day of result.days) {
    if (day.netPnl > 0) partial.winningDays += 1;
    if (day.netPnl < 0) partial.losingDays += 1;
    partial.bestDay = Math.max(partial.bestDay, day.netPnl);
    partial.worstDay = Math.min(partial.worstDay, day.netPnl);
  }

  const start = result.simulation.startingCash;
  let peak = 0;
  for (const point of result.equity) {
    const value = point.equity - start;
    peak = Math.max(peak, value);
    partial.equityHigh = Math.max(partial.equityHigh, value);
    partial.equityLow = Math.min(partial.equityLow, value);
    if (peak - value > partial.maxDrawdown) {
      partial.maxDrawdown = peak - value;
      partial.maxDrawdownPeak = peak;
    }
  }
  partial.equityEnd = (result.equity.at(-1)?.equity ?? start) - start;

  for (const event of result.events) {
    if (event.type === 'signal') partial.signals += 1;
    if (event.type === 'entrySkipped') {
      const reason = normalizeSkipReason(event.reason);
      partial.skipped[reason] = (partial.skipped[reason] ?? 0) + 1;
    }
  }
  return partial;
}

const mergeTallies = (a: Record<string, Tally>, b: Record<string, Tally>) => {
  const merged: Record<string, Tally> = { ...a };
  for (const [key, t] of Object.entries(b)) {
    const current = merged[key];
    merged[key] = current
      ? {
          trades: current.trades + t.trades,
          netPnl: current.netPnl + t.netPnl,
          wins: current.wins + t.wins,
          sumSq: current.sumSq + t.sumSq,
        }
      : t;
  }
  return merged;
};

/** Combines totals from back-to-back stretches, given in time order, as if they were one run. */
export function mergePartials(
  parts: readonly StatsPartial[],
): StatsPartial | undefined {
  const [first, ...rest] = parts;
  if (!first) return undefined;
  return rest.reduce((a, b) => {
    // b's equity values are relative to where a ended.
    const offset = a.equityEnd;
    const crossDrawdown = a.equityHigh - (offset + b.equityLow);
    const inside = b.maxDrawdown;
    const [maxDrawdown, maxDrawdownPeak] =
      Math.max(a.maxDrawdown, crossDrawdown, inside) === a.maxDrawdown
        ? [a.maxDrawdown, a.maxDrawdownPeak]
        : crossDrawdown >= inside
          ? [crossDrawdown, a.equityHigh]
          : [inside, offset + b.maxDrawdownPeak];

    const skipped = { ...a.skipped };
    for (const [reason, n] of Object.entries(b.skipped))
      skipped[reason] = (skipped[reason] ?? 0) + n;

    return {
      trades: a.trades + b.trades,
      wins: a.wins + b.wins,
      sumWins: a.sumWins + b.sumWins,
      sumLosses: a.sumLosses + b.sumLosses,
      sumNetSq: a.sumNetSq + b.sumNetSq,
      sumPnlPct: a.sumPnlPct + b.sumPnlPct,
      largestWin: Math.max(a.largestWin, b.largestWin),
      largestLoss: Math.min(a.largestLoss, b.largestLoss),
      fees: a.fees + b.fees,
      byReason: mergeTallies(a.byReason, b.byReason),
      byDirection: mergeTallies(a.byDirection, b.byDirection),
      byTicker: mergeTallies(a.byTicker, b.byTicker),
      days: a.days + b.days,
      winningDays: a.winningDays + b.winningDays,
      losingDays: a.losingDays + b.losingDays,
      bestDay: Math.max(a.bestDay, b.bestDay),
      worstDay: Math.min(a.worstDay, b.worstDay),
      equityEnd: offset + b.equityEnd,
      equityHigh: Math.max(a.equityHigh, offset + b.equityHigh),
      equityLow: Math.min(a.equityLow, offset + b.equityLow),
      maxDrawdown,
      maxDrawdownPeak,
      signals: a.signals + b.signals,
      skipped,
      daysLeftOpen: a.daysLeftOpen + b.daysLeftOpen,
    };
  }, first);
}

/** Mean divided by its standard error, from a count, sum and sum of squares. */
export function tStatOf(n: number, sum: number, sumSq: number): number {
  if (n < 2) return 0;
  const mean = sum / n;
  const variance = Math.max(0, (sumSq - n * mean ** 2) / (n - 1));
  const stdError = Math.sqrt(variance / n);
  return stdError > 0 ? mean / stdError : 0;
}

const breakdowns = (
  tallies: Record<string, Tally>,
): Record<string, Breakdown> =>
  Object.fromEntries(
    Object.entries(tallies).map(([key, t]) => [
      key,
      {
        trades: t.trades,
        netPnl: t.netPnl,
        winRate: t.trades ? t.wins / t.trades : 0,
        tStat: tStatOf(t.trades, t.netPnl, t.sumSq),
      },
    ]),
  );

export function finalizeStats(
  partial: StatsPartial,
  startingCash: number,
): BacktestStats {
  const { trades, wins } = partial;
  const losses = trades - wins;
  const netSum = partial.sumWins + partial.sumLosses;
  const expectancy = trades ? netSum / trades : 0;
  const grossLoss = -partial.sumLosses;
  const endingEquity = startingCash + partial.equityEnd;

  return {
    startingCash,
    endingEquity,
    netPnl: endingEquity - startingCash,
    returnPct: (endingEquity - startingCash) / startingCash,
    fees: partial.fees,

    trades,
    wins,
    losses,
    winRate: trades ? wins / trades : 0,
    avgWin: wins ? partial.sumWins / wins : 0,
    avgLoss: losses ? partial.sumLosses / losses : 0,
    largestWin: partial.largestWin,
    largestLoss: partial.largestLoss,
    profitFactor:
      grossLoss === 0 ? (wins ? Infinity : 0) : partial.sumWins / grossLoss,
    expectancy,
    tStat: tStatOf(trades, netSum, partial.sumNetSq),
    avgPnlPct: trades ? partial.sumPnlPct / trades : 0,

    maxDrawdown: partial.maxDrawdown,
    maxDrawdownPct:
      partial.maxDrawdown / (startingCash + partial.maxDrawdownPeak),

    tradingDays: partial.days,
    winningDays: partial.winningDays,
    losingDays: partial.losingDays,
    bestDay: partial.bestDay,
    worstDay: partial.worstDay,

    byReason: breakdowns(partial.byReason),
    byDirection: breakdowns(partial.byDirection),
    byTicker: breakdowns(partial.byTicker),
    signals: partial.signals,
    skipped: partial.skipped,
    daysLeftOpen: partial.daysLeftOpen,
  };
}

export function computeStats(result: BacktestResult): BacktestStats {
  return finalizeStats(
    partialFromResult(result),
    result.simulation.startingCash,
  );
}
