import { z } from 'zod';

import { OptionContract } from '../market/types';

/** A check the chosen contract must pass. If it fails, the trade is skipped rather than moved to another strike. */
export interface ContractFilter {
  readonly name: string;
  allow(contract: OptionContract): boolean;
}

export const maxSpreadPctConfigSchema = z.object({
  type: z.literal('maxSpreadPct'),
  /** Widest acceptable bid/ask spread, as a fraction of the midpoint. 0.05 is 5%. */
  pct: z.number().positive(),
});

export class MaxSpreadPct implements ContractFilter {
  readonly name = 'maxSpreadPct';
  private readonly pct: number;

  constructor(config: z.infer<typeof maxSpreadPctConfigSchema>) {
    this.pct = config.pct;
  }

  allow({ bid, ask }: OptionContract): boolean {
    if (bid <= 0 || ask < bid) return false;
    const mid = (bid + ask) / 2;
    return (ask - bid) / mid <= this.pct;
  }
}

export const minOpenInterestConfigSchema = z.object({
  type: z.literal('minOpenInterest'),
  /** Contracts with no open interest figure are rejected. */
  count: z.number().int().nonnegative(),
});

export class MinOpenInterest implements ContractFilter {
  readonly name = 'minOpenInterest';
  private readonly count: number;

  constructor(config: z.infer<typeof minOpenInterestConfigSchema>) {
    this.count = config.count;
  }

  allow({ openInterest }: OptionContract): boolean {
    return openInterest !== undefined && openInterest >= this.count;
  }
}

export const contractFilterConfigSchema = z.discriminatedUnion('type', [
  maxSpreadPctConfigSchema,
  minOpenInterestConfigSchema,
]);
export type ContractFilterConfig = z.infer<typeof contractFilterConfigSchema>;

export function createContractFilter(
  config: ContractFilterConfig,
): ContractFilter {
  switch (config.type) {
    case 'maxSpreadPct':
      return new MaxSpreadPct(config);
    case 'minOpenInterest':
      return new MinOpenInterest(config);
  }
}
