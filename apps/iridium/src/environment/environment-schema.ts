import z from 'zod';

import { preprocessBoolean } from '../utils/preprocessors';

export const environmentSchema = z
  .object({
    dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    debugLogging: z.preprocess(preprocessBoolean, z.boolean()).default(true),

    // strategy config
    targetEntry: z.coerce.number().min(0).max(1).default(0.97),
    minTimeRemainingMs: z.coerce.number().min(0).default(600_000), // 10 minutes
    maxTimeRemainingMs: z.coerce.number().min(0).default(3_000_000), // 50 minutes - this makes a 40 minute window
    targetPositionSize: z.coerce.number().min(0).default(10),
    minSkewPriceCutoff: z.coerce.number().min(0).default(0.35),
    enableSkewCheck: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    minTotalCost: z.coerce.number().min(0).default(0.8),
    maxTotalCost: z.coerce.number().min(0).default(1.01),
    mergeDebounceMs: z.coerce.number().min(0).default(30_000),

    // price stability config (prevents entering during spikes)
    priceStabilityRangeCents: z.coerce.number().min(0).default(0), // +/- range in cents
    priceStabilityDurationMs: z.coerce.number().min(0).default(0), // how long price must be stable

    // stop loss config
    panicPriceDropThreshold: z.coerce.number().min(0).max(1).default(0.1),
    panicSustainedDropMs: z.coerce.number().min(0).default(600_000),
    panicAbsoluteTimeoutMs: z.coerce.number().min(0).default(900_000),

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
