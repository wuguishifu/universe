import z from 'zod';

import { preprocessBoolean } from '../utils/preprocessors';

export const environmentSchema = z
  .object({
    dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    maxHistoryRetentionMs: z.coerce.number().min(0).default(5_000),
    reconcileIntervalMs: z.coerce.number().min(5_000).default(30_000),
    reconcileLedgerSync: z.preprocess(preprocessBoolean, z.boolean()).default(true),

    // strategy config
    targetEntry: z.coerce.number().min(0).max(1).default(0.97),
    targetPositionSize: z.coerce.number().min(0).default(10),
    mergeDebounceMs: z.coerce.number().min(0).default(10_000),

    // time filtering config
    minTimeRemainingMs: z.coerce.number().min(0).default(300_000),
    maxTimeRemainingMs: z.coerce.number().min(0).default(3_300_000),

    // skew config
    enableSkewCheck: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    minSkewPriceCutoff: z.coerce.number().min(0).default(0.15),
    minTotalCost: z.coerce.number().min(0).default(0.8),
    maxTotalCost: z.coerce.number().min(0).default(1.01),

    // price stability config (prevents entering during spikes)
    enablePriceStabilityCheck: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    priceStabilityRangeCents: z.coerce.number().min(0).default(3),
    priceStabilityDurationMs: z.coerce.number().min(0).default(2_000),

    // momentum config
    enableMomentumDiscounting: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    velocityFactor: z.coerce.number().min(0).default(0.8),
    accelerationFactor: z.coerce.number().min(0).default(0.4),
    maxDiscount: z.coerce.number().min(0).default(0.05),

    // stop loss config
    panicPriceDropThreshold: z.coerce.number().min(0).max(1).default(0.05),
    panicSustainedDropMs: z.coerce.number().min(0).default(30_000),
    panicAbsoluteTimeoutMs: z.coerce.number().min(0).default(300_000),

    // clob config
    privateKey: z.string().min(1, { message: 'private key required' }),
    signatureType: z.coerce.number().min(0).max(2).default(1),
    funderAddress: z.string().optional(),

    // relayer config
    polyApiKey: z.string(),
    polyApiSecret: z.string(),
    polyApiPassphrase: z.string(),
  })
  .refine((data) => data.signatureType !== 1 || !!data.funderAddress, {
    message: 'funderAddress is required when signatureType is 1',
    path: ['funderAddress'],
  });
