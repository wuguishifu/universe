import { z } from 'zod';

/** Lookbacks are written in trading days; a month is taken as 21 of them. */
export const TRADING_DAYS_PER_MONTH = 21;

const tickerSchema = z.string().min(1);
const tickersSchema = z.array(tickerSchema).min(1);

/** Hold the same weights every rebalance. Benchmarks: buy-and-hold, 60/40, equal weight. */
export const fixedRuleSchema = z.object({
  type: z.literal('fixed'),
  weights: z
    .record(tickerSchema, z.number().nonnegative())
    .refine(
      (weights) =>
        Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-9,
      'weights must add up to 1',
    ),
});

/**
 * Faber-style trend following: each asset gets an equal share, held only while its close is
 * above its `smaDays` average. A share that isn't held sits in cash.
 */
export const trendRuleSchema = z.object({
  type: z.literal('trend'),
  assets: tickersSchema,
  smaDays: z.number().int().positive(),
});

/**
 * Hold the `top` assets with the best return over `lookbackDays`, measured up to `skipDays`
 * before the decision. With `absolute`, a pick whose return doesn't beat cash over the same
 * window is replaced by `fallback` (cash when left out), as in dual momentum.
 */
export const momentumRuleSchema = z.object({
  type: z.literal('momentum'),
  assets: tickersSchema,
  top: z.number().int().positive(),
  lookbackDays: z.number().int().positive(),
  skipDays: z.number().int().nonnegative().default(0),
  absolute: z.boolean().default(false),
  fallback: tickerSchema.optional(),
});

export const allocationRuleSchema = z.discriminatedUnion('type', [
  fixedRuleSchema,
  trendRuleSchema,
  momentumRuleSchema,
]);
export type AllocationRule = z.infer<typeof allocationRuleSchema>;

export const allocationConfigSchema = z.object({
  /** Where money that isn't allocated goes, e.g. a T-bill ETF. */
  cash: tickerSchema,
  rule: allocationRuleSchema,
});
export type AllocationConfig = z.infer<typeof allocationConfigSchema>;

/** Daily closes per ticker, oldest first, ending with the decision day's close. */
export type PriceHistory = Readonly<Record<string, readonly number[]>>;
/** Fraction of equity per ticker. Weights add up to 1. */
export type Weights = Record<string, number>;

/** Every ticker the config can hold or needs prices for. */
export function allocationTickers(config: AllocationConfig): string[] {
  const { rule } = config;
  const tickers =
    rule.type === 'fixed'
      ? Object.keys(rule.weights)
      : [
          ...rule.assets,
          ...(rule.type === 'momentum' && rule.fallback ? [rule.fallback] : []),
        ];
  return [...new Set([...tickers, config.cash])];
}

/** Return from `lookback + skip` days ago to `skip` days ago, or undefined without enough history. */
export function lookbackReturn(
  closes: readonly number[],
  lookback: number,
  skip = 0,
): number | undefined {
  const end = closes[closes.length - 1 - skip];
  const start = closes[closes.length - 1 - skip - lookback];
  return end === undefined || start === undefined ? undefined : end / start - 1;
}

/** Average of the last `days` closes, or undefined without enough history. */
export function simpleAverage(
  closes: readonly number[],
  days: number,
): number | undefined {
  if (closes.length < days) return undefined;
  let sum = 0;
  for (let i = closes.length - days; i < closes.length; i++)
    sum += closes[i] ?? 0;
  return sum / days;
}

const add = (weights: Weights, ticker: string, weight: number): void => {
  weights[ticker] = (weights[ticker] ?? 0) + weight;
};

/**
 * The weights to rebalance to, given prices up to the decision day. Null while some ticker
 * doesn't have enough history, in which case the caller should leave the portfolio alone.
 */
export function targetWeights(
  config: AllocationConfig,
  history: PriceHistory,
): Weights | null {
  const { rule, cash } = config;
  const closesOf = (ticker: string): readonly number[] => history[ticker] ?? [];

  if (rule.type === 'fixed') return { ...rule.weights };

  const weights: Weights = {};
  if (rule.type === 'trend') {
    const share = 1 / rule.assets.length;
    for (const asset of rule.assets) {
      const closes = closesOf(asset);
      const average = simpleAverage(closes, rule.smaDays);
      const last = closes.at(-1);
      if (average === undefined || last === undefined) return null;
      add(weights, last > average ? asset : cash, share);
    }
    return weights;
  }

  const returns: Array<{ asset: string; value: number }> = [];
  for (const asset of rule.assets) {
    const value = lookbackReturn(
      closesOf(asset),
      rule.lookbackDays,
      rule.skipDays,
    );
    if (value === undefined) return null;
    returns.push({ asset, value });
  }
  const hurdle = rule.absolute
    ? lookbackReturn(closesOf(cash), rule.lookbackDays, rule.skipDays)
    : undefined;
  if (rule.absolute && hurdle === undefined) return null;

  // Sort is stable, so ties keep the order the assets were listed in.
  const picks = returns.sort((a, b) => b.value - a.value).slice(0, rule.top);
  const share = 1 / picks.length;
  for (const pick of picks) {
    const passes = hurdle === undefined || pick.value > hurdle;
    add(weights, passes ? pick.asset : (rule.fallback ?? cash), share);
  }
  return weights;
}

/** True on the last trading day of a month: the next trading day is in a different month. */
export const isMonthEnd = (
  date: string,
  nextDate: string | undefined,
): boolean =>
  nextDate !== undefined && nextDate.slice(0, 7) !== date.slice(0, 7);
