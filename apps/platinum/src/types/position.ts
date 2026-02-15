import { z } from 'zod';

export type Position = z.infer<typeof positionSchema>;
export const positionSchema = z.object({
  proxyWallet: z.string(),
  asset: z.string(),
  conditionId: z.string(),
  size: z.number(),
  avgPrice: z.number(),
  initialValue: z.number(),
  currentValue: z.number(),
  cashPnl: z.number(),
  percentPnl: z.number(),
  totalBought: z.number(),
  realizedPnl: z.number(),
  curPrice: z.number(),
  redeemable: z.boolean(),
  mergeable: z.boolean(),
  title: z.string(),
  slug: z.string(),
  icon: z.string(),
  eventSlug: z.string(),
  outcome: z.string(),
  outcomeIndex: z.number(),
  oppositeOutcome: z.string(),
  oppositeAsset: z.string(),
  endDate: z.string(),
  negativeRisk: z.boolean(),
});
