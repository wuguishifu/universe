import { z } from 'zod';

import { daysBetween } from '../market/ny-time';

export interface ExpirySelector {
  /** Picks one of `expirations` (`YYYY-MM-DD`, sorted ascending), or null if none qualify. */
  select(expirations: readonly string[], today: string): string | null;
}

export const nearestExpiryConfigSchema = z.object({
  type: z.literal('nearest'),
  /** Fewest calendar days to expiration. 0 allows same-day (0DTE) contracts, 1 skips them. */
  minDte: z.number().int().nonnegative().default(0),
  /** Most calendar days to expiration. No limit when left out. */
  maxDte: z.number().int().nonnegative().optional(),
});

/** The soonest expiration within the DTE range. */
export class NearestExpiry implements ExpirySelector {
  private readonly config: z.infer<typeof nearestExpiryConfigSchema>;

  constructor(config: z.infer<typeof nearestExpiryConfigSchema>) {
    this.config = config;
  }

  select(expirations: readonly string[], today: string): string | null {
    const { minDte, maxDte } = this.config;
    for (const expiration of expirations) {
      const dte = daysBetween(today, expiration);
      if (dte < minDte) continue;
      return maxDte === undefined || dte <= maxDte ? expiration : null;
    }
    return null;
  }
}

export const expiryConfigSchema = z.discriminatedUnion('type', [
  nearestExpiryConfigSchema,
]);
export type ExpiryConfig = z.infer<typeof expiryConfigSchema>;

export function createExpirySelector(config: ExpiryConfig): ExpirySelector {
  switch (config.type) {
    case 'nearest':
      return new NearestExpiry(config);
  }
}
