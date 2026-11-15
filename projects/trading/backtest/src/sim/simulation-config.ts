import { z } from 'zod';

export const simulationConfigSchema = z.object({
  startingCash: z.number().positive().default(25_000),
  /**
   * Alpaca has no historical option quotes, so the bid/ask is modeled around each traded price:
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
