import z from 'zod';

export const config = z
  .object({
    environmentKey: z.enum(['development', 'staging', 'production']),
    portfolio: z.object({
      PRISMIC_REVALIDATE_SECRET: z.string(),
    }),
  })
  .strict();
