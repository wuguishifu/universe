import { z } from 'zod';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z
  .object({
    debugLogging: z.stringbool().default(false),
    environment: z.enum(['development', 'production']).default('development'),
    s3AccessKeyId: z.string().min(1),
    s3Bucket: z.string().min(1),
    s3Endpoint: z.string().min(1),
    s3Region: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3ForcePathStyle: z.stringbool().default(false),
    silverAdminApiToken: z.string().min(1),
    redisUrl: z.string().min(1),
    convexUrl: z.string().min(1),
    convexSiteUrl: z.string().min(1),
  })
  .transform(({ silverAdminApiToken: adminApiToken, ...data }) => {
    return {
      adminApiToken,
      ...data,
    };
  });
