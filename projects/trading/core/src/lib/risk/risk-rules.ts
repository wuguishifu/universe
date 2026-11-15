import { z } from 'zod';

export type RiskInput = {
  /** What one more contract of the new entry would cost. */
  costPerContract: number;
  /** Capital already in positions, including orders not yet filled. */
  tiedCapital: number;
  /** Positions held or being opened or closed, across every ticker. */
  positions: number;
  equity: number | undefined;
};

/** Caps how many contracts a new entry may buy. The entry takes the smallest cap of all rules. */
export interface RiskRule {
  readonly name: string;
  maxContracts(input: RiskInput): number;
}

export const maxTiedCapitalConfigSchema = z
  .object({
    type: z.literal('maxTiedCapital'),
    /** Most money held in positions at once. */
    dollars: z.number().positive().optional(),
    /** Most of account equity held in positions at once, as a fraction. */
    pctEquity: z.number().positive().max(1).optional(),
  })
  .refine((c) => c.dollars !== undefined || c.pctEquity !== undefined, {
    message: 'maxTiedCapital needs dollars, pctEquity, or both',
  });

export const maxPositionsConfigSchema = z.object({
  type: z.literal('maxPositions'),
  count: z.number().int().positive(),
});

export const riskRuleConfigSchema = z.discriminatedUnion('type', [
  maxTiedCapitalConfigSchema,
  maxPositionsConfigSchema,
]);
export type RiskRuleConfig = z.infer<typeof riskRuleConfigSchema>;

export function createRiskRule(config: RiskRuleConfig): RiskRule {
  switch (config.type) {
    case 'maxTiedCapital':
      return {
        name: 'maxTiedCapital',
        maxContracts({ costPerContract, tiedCapital, equity }) {
          let limit = config.dollars ?? Number.POSITIVE_INFINITY;
          if (config.pctEquity !== undefined) {
            // A percentage of an unknown equity can't be honoured, so allow nothing.
            limit = Math.min(
              limit,
              equity === undefined ? 0 : equity * config.pctEquity,
            );
          }
          return Math.max(
            0,
            Math.floor((limit - tiedCapital) / costPerContract),
          );
        },
      };
    case 'maxPositions':
      return {
        name: 'maxPositions',
        maxContracts: ({ positions }) =>
          positions < config.count ? Number.POSITIVE_INFINITY : 0,
      };
  }
}
