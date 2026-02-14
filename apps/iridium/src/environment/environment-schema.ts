import z from 'zod';

import { preprocessBoolean } from '../utils/preprocessors';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z
  .object({
    dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    enableVerboseEvents: z.preprocess(preprocessBoolean, z.boolean()).default(false),
    debugClearStraddles: z.preprocess(preprocessBoolean, z.boolean()).default(false),
    adapter: z.enum(['crypto-5m', 'crypto-1h']).default('crypto-5m'),

    maxHistoryRetentionMs: z.coerce.number().min(0).default(5_000),
    reconcileIntervalMs: z.coerce.number().min(10_000).default(10_000),
    mergeIntervalMs: z.coerce.number().min(10_000).default(10_000),
    claimIntervalMs: z.coerce.number().min(0).default(1_800_000),
    ledgerSyncIntervalMs: z.coerce.number().min(10_000).default(10_000),
    straddleCooldownMsOverride: z.coerce.number().min(0).optional(),
    tradingStartHourUtcOverride: z.coerce.number().min(0).max(23).optional(),
    tradingEndHourUtcOverride: z.coerce.number().min(0).max(23).optional(),

    // strategy config
    targetEntry: z.coerce.number().min(0).max(1).default(0.95),
    targetPositionSize: z.coerce.number().min(0).default(10),
    maxAllocationRatio: z.coerce.number().min(0).max(1).default(0.8),

    // time filtering config
    minTimeRemainingMsOverride: z.coerce.number().min(0).optional(),
    maxTimeRemainingMsOverride: z.coerce.number().min(0).optional(),

    // stop loss config
    stopLossTimeoutMsOverride: z.coerce.number().min(0).optional(),
    stopLossMaxDropCents: z.coerce.number().min(0).optional(),
    stopLossGracePeriodMs: z.coerce.number().min(0).optional(),
    stopLossMinTimeRemainingMs: z.coerce.number().min(0).optional(),

    // skew config
    enableSkewCheck: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    minSkewPriceCutoff: z.coerce.number().min(0).default(0.15),
    minTotalCost: z.coerce.number().min(0).default(0.8),
    maxTotalCost: z.coerce.number().min(0).default(1.01),

    // price stability config (prevents entering during spikes)
    enablePriceStabilityCheck: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    priceStabilityRangeCents: z.coerce.number().min(0).default(3),
    priceStabilityDurationMs: z.coerce.number().min(0).default(1_000),

    // linear regression filter (alternative to stability check)
    enableLinearRegressionFilter: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    maxPriceSlopePerSec: z.coerce.number().min(0).default(0.02),
    minRegressionDataPoints: z.coerce.number().min(2).default(10),

    // order book imbalance filter
    enableObiFilter: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    minObiBidAskRatio: z.coerce.number().min(0).default(0.5),

    // book depth filter
    enableBookDepthFilter: z.preprocess(preprocessBoolean, z.boolean()).default(false),
    minBookDepth: z.coerce.number().min(0).default(20),

    // toxic flow filter
    enableToxicFlowFilter: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    toxicFlowWindowMs: z.coerce.number().min(0).default(3_000),
    toxicFlowMinTrades: z.coerce.number().min(1).default(5),
    toxicFlowSellRatioThreshold: z.coerce.number().min(0).max(1).default(0.8),

    // fill gap cap — prevents one-legged fills from asymmetric momentum
    enableFillGapCap: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    maxAskDistance: z.coerce.number().min(0).default(0.02),

    // momentum config
    enableMomentumDiscounting: z.preprocess(preprocessBoolean, z.boolean()).default(true),
    velocityFactor: z.coerce.number().min(0).default(0.8),
    accelerationFactor: z.coerce.number().min(0).default(0.4),
    maxDiscount: z.coerce.number().min(0).default(0.05),

    // inventory skew config
    enableInventorySkew: z.preprocess(preprocessBoolean, z.boolean()).default(false),
    skewCentsPerShare: z.coerce.number().min(0).default(0.1),
    maxSkewAdjustment: z.coerce.number().min(0).default(0.05),

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
  })
  .transform((data) => ({
    ...data,
    dryRun: data.dryRun || data.debugClearStraddles, // force dry run if debugClearStraddles is enabled
  }));
