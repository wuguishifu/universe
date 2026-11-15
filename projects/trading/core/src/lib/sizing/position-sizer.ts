import { z } from 'zod';

export type SizingInput = {
  /** Price per share the entry will pay (the ask). */
  price: number;
  /** Shares per contract. */
  multiplier: number;
  /** Account equity, if the host has reported it. */
  equity: number | undefined;
};

export interface PositionSizer {
  /** Number of contracts to buy. 0 skips the trade. */
  size(input: SizingInput): number;
}

const affordable = (
  budget: number,
  { price, multiplier }: SizingInput,
): number => Math.floor(budget / (price * multiplier));

export const fixedContractsConfigSchema = z.object({
  type: z.literal('contracts'),
  count: z.number().int().positive(),
});

export const fixedDollarsConfigSchema = z.object({
  type: z.literal('dollars'),
  /** Spend up to this much per entry. */
  amount: z.number().positive(),
});

export const pctEquityConfigSchema = z.object({
  type: z.literal('pctEquity'),
  /** Spend up to this fraction of account equity per entry. 0.05 is 5%. */
  pct: z.number().positive().max(1),
});

export const sizingConfigSchema = z.discriminatedUnion('type', [
  fixedContractsConfigSchema,
  fixedDollarsConfigSchema,
  pctEquityConfigSchema,
]);
export type SizingConfig = z.infer<typeof sizingConfigSchema>;

export function createPositionSizer(config: SizingConfig): PositionSizer {
  switch (config.type) {
    case 'contracts':
      return { size: () => config.count };
    case 'dollars':
      return { size: (input) => affordable(config.amount, input) };
    case 'pctEquity':
      return {
        size: (input) =>
          input.equity === undefined
            ? 0
            : affordable(input.equity * config.pct, input),
      };
  }
}
