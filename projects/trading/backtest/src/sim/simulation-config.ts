import { z } from 'zod';

export const simulationConfigSchema = z.object({
  startingCash: z.number().positive().default(25_000),
  /**
   * Which option price an order fills at, before the spread:
   * `nextTrade` is the first trade at or after the order, as a market order would get. Orders with
   * no trade within `maxPriceAgeMinutes` are rejected.
   * `decision` is the last trade the engine saw when it decided. That flatters a momentum signal,
   * because the option hasn't caught up with the move yet, so it's only for comparison.
   */
  fillAt: z.enum(['nextTrade', 'decision']).default('nextTrade'),
  /**
   * Where option prices come from:
   * `trades` models a bid/ask around each traded price, using `spreadPct` and `minSpread`.
   * `quotes` uses the real bid/ask history in `data/quotes` (see the README's "Option quotes"). Buys
   * pay the ask and sells get the bid that stood when the order went out, positions are marked
   * once a minute, and `fillAt`, `spreadPct`, `minSpread` and `maxPriceAgeMinutes` are ignored.
   */
  prices: z.enum(['trades', 'quotes']).default('trades'),
  /**
   * With `prices: trades`, the bid/ask is modeled around each traded price:
   * a spread of this fraction of the price, split evenly either side.
   */
  spreadPct: z.number().nonnegative().default(0.03),
  /** Narrowest modeled spread, in dollars per share. */
  minSpread: z.number().nonnegative().default(0.01),
  /** Extra adverse movement on every fill, beyond paying the spread, as a fraction of price. */
  slippagePct: z.number().nonnegative().default(0),
  /** Charged on every contract bought or sold. Alpaca charges no commission, but regulatory fees apply. */
  feePerContract: z.number().nonnegative().default(0.05),
  /** When building a chain, ignore contracts whose last trade is older than this many minutes. */
  maxPriceAgeMinutes: z.number().positive().default(5),
  /** Trading days before `from` fed through the indicators without trading. */
  warmupDays: z.number().int().nonnegative().default(5),
});
export type SimulationConfig = z.infer<typeof simulationConfigSchema>;
export type SimulationConfigInput = z.input<typeof simulationConfigSchema>;
