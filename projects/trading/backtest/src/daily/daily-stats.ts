import { DailyResult } from './daily-backtest';

const TRADING_DAYS_PER_YEAR = 252;

export type DailyStats = {
  start: string;
  end: string;
  startValue: number;
  endValue: number;
  totalReturn: number;
  /** Compound annual growth rate. */
  cagr: number;
  /** Annualized standard deviation of daily returns. */
  volatility: number;
  /** Annualized mean over standard deviation of daily returns in excess of the cash ticker. */
  sharpe: number;
  /** Largest fall from a peak close, as a fraction of the peak, and the date of the low. */
  maxDrawdown: number;
  maxDrawdownDate: string;
  worstMonth: number;
  /** Compounded return per calendar year. The first and last years may be partial. */
  byYear: Record<string, number>;
  /** Monthly returns, `YYYY-MM` → return, for comparing strategies month by month. */
  byMonth: Record<string, number>;
  rebalances: number;
  /** Average turnover per year, in multiples of equity (buys plus sells). */
  turnoverPerYear: number;
  costs: number;
  /** Average weight held in the cash ticker across rebalances. */
  cashShare: number;
};

const compound = (returns: Map<string, number>, key: string, r: number) =>
  returns.set(key, ((returns.get(key) ?? 0) + 1) * (1 + r) - 1);

export function dailyStats(result: DailyResult): DailyStats | null {
  const first = result.equity[0];
  const last = result.equity.at(-1);
  if (!first || !last) return null;

  const years = new Map<string, number>();
  const months = new Map<string, number>();
  let sum = 0;
  let sumSq = 0;
  let excessSum = 0;
  let excessSq = 0;
  let previous = result.startingCash;
  let peak = result.startingCash;
  let maxDrawdown = 0;
  let maxDrawdownDate = first.date;
  for (const point of result.equity) {
    const r = point.value / previous - 1;
    previous = point.value;
    sum += r;
    sumSq += r * r;
    const excess = r - point.cashReturn;
    excessSum += excess;
    excessSq += excess * excess;
    compound(years, point.date.slice(0, 4), r);
    compound(months, point.date.slice(0, 7), r);
    peak = Math.max(peak, point.value);
    const drawdown = 1 - point.value / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownDate = point.date;
    }
  }

  const n = result.equity.length;
  const sd = (s: number, sq: number) =>
    n > 1 ? Math.sqrt(Math.max(0, (sq - (s * s) / n) / (n - 1))) : 0;
  const excessSd = sd(excessSum, excessSq);
  const elapsedYears =
    (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86_400_000) ||
    1 / TRADING_DAYS_PER_YEAR;
  const totalReturn = last.value / result.startingCash - 1;
  const cashWeights = result.rebalances.map((r) => r.weights[result.cash] ?? 0);

  return {
    start: first.date,
    end: last.date,
    startValue: result.startingCash,
    endValue: last.value,
    totalReturn,
    cagr: (1 + totalReturn) ** (1 / elapsedYears) - 1,
    volatility: sd(sum, sumSq) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    sharpe:
      excessSd === 0
        ? 0
        : (excessSum / n / excessSd) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    maxDrawdown,
    maxDrawdownDate,
    worstMonth: Math.min(0, ...months.values()),
    byYear: Object.fromEntries(years),
    byMonth: Object.fromEntries(months),
    rebalances: result.rebalances.length,
    turnoverPerYear:
      result.rebalances.reduce((a, r) => a + r.turnover, 0) / elapsedYears,
    costs: result.costs,
    cashShare:
      cashWeights.reduce((a, b) => a + b, 0) / (cashWeights.length || 1),
  };
}
