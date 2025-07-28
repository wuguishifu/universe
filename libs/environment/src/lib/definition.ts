import z from 'zod';

export const config = z
  .object({
    environmentKey: z.enum(['development', 'staging', 'production']),
  })
  .strict();
