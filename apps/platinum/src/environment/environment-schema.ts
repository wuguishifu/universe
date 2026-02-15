import z from 'zod';

// TODO: move to common parsing library
export const preprocessBoolean = (value: unknown) => {
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return Boolean(value);
};

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z
  .object({
    enableVerboseEvents: z.preprocess(preprocessBoolean, z.boolean()).default(false),
    dryRun: z.preprocess(preprocessBoolean, z.boolean()).default(true),

    userAddress: z.string(),
    mergeIntervalMs: z.coerce.number().min(10_000).default(10_000),
    claimIntervalMs: z.coerce.number().min(10_000).default(60_000),

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
