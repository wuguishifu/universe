import z from 'zod';

export const config = z
  .object({
    environmentKey: z.enum(['development', 'staging', 'production']),
    quartz: z.object({
      PRISMIC_REVALIDATE_SECRET: z.string(),
    }),
    osmium: z.object({
      apiAccessKey: z.string(),
    }),
    hydrogen: z.object({
      host: z.string(),
      port: z.number(),
      user: z.string(),
      password: z.string(),
      database: z.string(),
    }),
  })
  .strict();
