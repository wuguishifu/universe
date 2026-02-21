import z from 'zod';

import { preprocessBoolean } from '@wuguishifu/utils-parse';

import { ADAPTERS } from '../constants/constants';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),
  enableVerboseEvents: z.preprocess(preprocessBoolean, z.boolean()).default(false),
  adapter: z.enum(ADAPTERS).default('crypto-5m'),

  // ledge configuration
  maxAllocationRatio: z.number().min(0).max(1).default(0.8),
  ledgerSyncIntervalMs: z.number().min(5_000).default(60_000),

  // alpha configuration
  maxHistoryRetentionMs: z.number().min(0).default(30_000),
});
