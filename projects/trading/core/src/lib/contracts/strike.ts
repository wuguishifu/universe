import { z } from 'zod';

import { OptionContract, OptionType } from '../market/types';

export interface StrikeSelector {
  /**
   * Picks one contract from `contracts`, which all share a type and expiration and are sorted
   * by strike, ascending. Returns null if none fit.
   */
  select(
    contracts: readonly OptionContract[],
    underlyingPrice: number,
    type: OptionType,
  ): OptionContract | null;
}

/** Index of the strike closest to the underlying price. Ties go to the lower strike. */
function atmIndex(
  contracts: readonly OptionContract[],
  underlyingPrice: number,
): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  contracts.forEach((contract, i) => {
    const distance = Math.abs(contract.strike - underlyingPrice);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

export const atmStrikeConfigSchema = z.object({ type: z.literal('atm') });

export const strikeOffsetConfigSchema = z.object({
  type: z.literal('strikeOffset'),
  /**
   * Strikes away from at-the-money. Positive moves out of the money (higher strikes for calls,
   * lower for puts) and negative moves into the money.
   */
  steps: z.number().int(),
});

/** At-the-money is a strike offset of zero. */
export class StrikeOffset implements StrikeSelector {
  private readonly steps: number;

  constructor(steps: number) {
    this.steps = steps;
  }

  select(
    contracts: readonly OptionContract[],
    underlyingPrice: number,
    type: OptionType,
  ): OptionContract | null {
    const atm = atmIndex(contracts, underlyingPrice);
    if (atm < 0) return null;
    const index = atm + (type === 'call' ? this.steps : -this.steps);
    return contracts[index] ?? null;
  }
}

export const strikeConfigSchema = z.discriminatedUnion('type', [
  atmStrikeConfigSchema,
  strikeOffsetConfigSchema,
]);
export type StrikeConfig = z.infer<typeof strikeConfigSchema>;

export function createStrikeSelector(config: StrikeConfig): StrikeSelector {
  switch (config.type) {
    case 'atm':
      return new StrikeOffset(0);
    case 'strikeOffset':
      return new StrikeOffset(config.steps);
  }
}
