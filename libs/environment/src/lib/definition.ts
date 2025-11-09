import z from 'zod';

export const config = z
  .object({
    environmentKey: z.enum(['development', 'staging', 'production']),
    quartz: z.object({
      PRISMIC_REVALIDATE_SECRET: z.string(),
    }),
  })
  .strict();
