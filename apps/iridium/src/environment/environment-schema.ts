import z from 'zod';

import { preprocessBoolean } from '../utils/preprocessors';

export const environmentSchema = z
  .object({
    dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),

    // strategy config
    targetEntry: z.coerce.number().min(0).max(1).default(0.97),
    minTimeRemainingMs: z.coerce.number().min(0).default(300_000), // 5 minutes
    maxTimeRemainingMs: z.coerce.number().min(0).default(3_300_000), // 55 minutes - this makes a 50 minute window
    targetPositionSize: z.coerce.number().min(0).default(10),
    minSkewPriceCutoff: z.coerce.number().min(0).default(0.25),
    enableSkewCheck: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    minTotalCost: z.coerce.number().min(0).default(0.8),
    maxTotalCost: z.coerce.number().min(0).default(1.01),
    mergeDebounceMs: z.coerce.number().min(0).default(5000),

    // price stability config (prevents entering during spikes)
    priceStabilityRangeCents: z.coerce.number().min(0).default(5), // +/- range in cents
    priceStabilityDurationMs: z.coerce.number().min(0).default(10_000), // how long price must be stable

    // stop loss config
    panicPriceDropThreshold: z.coerce.number().min(0).max(1).default(0.1),
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
