import z from 'zod';

import { preprocessBoolean } from '@wuguishifu/utils-parse';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z
  .object({
    enableVerboseEvents: z.preprocess(preprocessBoolean, z.boolean()).default(false),
    dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),

    userAddress: z.string(),
    liquidationIntervalMs: z.coerce.number().min(10_000).default(10_000),

    // clob config
    privateKey: z.string().min(1, { message: 'private key required' }),
    signatureType: z.coerce.number().min(0).max(2).default(1),
    funderAddress: z.string().optional(),

    // relayer config
    polyApiKey: z.string(),
    polyApiSecret: z.string(),
    polyApiPassphrase: z.string(),
    polygonRpcUrl: z.string().url().default('https://polygon-rpc.com'),
  })
  .refine((data) => data.signatureType !== 1 || !!data.funderAddress, {
    message: 'funderAddress is required when signatureType is 1',
    path: ['funderAddress'],
  });
