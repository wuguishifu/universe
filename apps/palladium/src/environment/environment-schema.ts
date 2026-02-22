import z from 'zod';

import { preprocessBoolean } from '@wuguishifu/utils-parse';

import { ADAPTERS } from '../constants/constants';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),
  enableVerboseEvents: z.preprocess(preprocessBoolean, z.boolean()).default(false),
  adapter: z.enum(ADAPTERS).default('crypto-5m'),

  // ledge configuration
  maxAllocationRatio: z.coerce.number().min(0).max(1).default(0.8),
  ledgerSyncIntervalMs: z.coerce.number().min(5_000).default(60_000),

  // strategy config
  targetPositionSize: z.coerce.number().min(1).default(10),
  minPriceDistancePercent: z.coerce.number().min(0).default(0.003),
  minTimeRemainingMs: z.coerce.number().min(0).default(0),
  maxTimeRemainingMs: z.coerce.number().min(0).default(10_000),
});
