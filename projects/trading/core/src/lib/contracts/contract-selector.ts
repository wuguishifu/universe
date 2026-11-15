import { z } from 'zod';

import { OptionContract, OptionType } from '../market/types';

import {
  ContractFilter,
  contractFilterConfigSchema,
  createContractFilter,
} from './contract-filters';
import {
  createExpirySelector,
  ExpirySelector,
  expiryConfigSchema,
} from './expiry';
import {
  createStrikeSelector,
  StrikeSelector,
  strikeConfigSchema,
} from './strike';

export const contractConfigSchema = z.object({
  expiry: expiryConfigSchema,
  strike: strikeConfigSchema,
  filters: z.array(contractFilterConfigSchema).default([]),
});
export type ContractConfig = z.infer<typeof contractConfigSchema>;

export type ContractRequest = {
  chain: readonly OptionContract[];
  type: OptionType;
  underlyingPrice: number;
  /** New York date, `YYYY-MM-DD`. */
  today: string;
};

export type ContractSelection =
  { ok: true; contract: OptionContract } | { ok: false; reason: string };

/** Picks an expiration, then a strike within it, then checks the result against every filter. */
export class ContractSelector {
  private readonly expiry: ExpirySelector;
  private readonly strike: StrikeSelector;
  private readonly filters: ContractFilter[];

  constructor(config: ContractConfig) {
    this.expiry = createExpirySelector(config.expiry);
    this.strike = createStrikeSelector(config.strike);
    this.filters = config.filters.map(createContractFilter);
  }

  select({
    chain,
    type,
    underlyingPrice,
    today,
  }: ContractRequest): ContractSelection {
    const ofType = chain.filter((contract) => contract.type === type);
    const expirations = [...new Set(ofType.map((c) => c.expiration))].sort();
    const expiration = this.expiry.select(expirations, today);
    if (!expiration) return { ok: false, reason: 'no expiration fits' };

    const strikes = ofType
      .filter((contract) => contract.expiration === expiration)
      .sort((a, b) => a.strike - b.strike);
    const contract = this.strike.select(strikes, underlyingPrice, type);
    if (!contract)
      return { ok: false, reason: `no strike fits on ${expiration}` };

    const failed = this.filters.find((filter) => !filter.allow(contract));
    if (failed) {
      return {
        ok: false,
        reason: `${contract.symbol} rejected by ${failed.name}`,
      };
    }
    return { ok: true, contract };
  }
}
