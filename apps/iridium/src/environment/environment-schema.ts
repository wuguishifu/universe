import z from 'zod';

export const environmentSchema = z.object({
  minDepthUsd: z.number().min(0).default(100),
  minRemainingTimeMs: z
    .number()
    .min(0)
    .default(5 * 60 * 1000),
  maxBalancedPrice: z.number().min(0).max(1).default(0.65),
  minBalancedPrice: z.number().min(0).max(1).default(0.35),
  maxSpreadRatio: z.number().min(0).max(1).default(0.1),
});
