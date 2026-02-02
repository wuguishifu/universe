import z from 'zod';

export const environmentSchema = z
  .object({
    targetEntry: z.coerce.number().min(0).max(1).default(0.97),
    minTimeRemainingMs: z.coerce.number().min(0).default(300_000),
    minTimeElapsedMs: z.coerce.number().min(0).default(0),
    targetPositionSize: z.coerce.number().min(0).default(50),
    panicExitDelayMs: z.coerce.number().min(0).default(120_000),

    // clob config
    privateKey: z.string().min(1, { error: 'private key required' }),
    funderAddress: z.string().min(1),
    signatureType: z.coerce.number().min(0).max(2).default(1),

    // relayer config
    polyApiKey: z.string(),
    polyApiSecret: z.string(),
    polyApiPassphrase: z.string(),
  })
  .refine((data) => data.signatureType !== 1 || !!data.funderAddress, {
    message: 'funderAddress is required when signatureType is 1',
    path: ['funderAddress'],
  });
