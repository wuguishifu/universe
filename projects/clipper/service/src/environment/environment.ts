import { z } from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
  s3EnvAdapter,
} from '@libs/nest-common';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema
  .extend({
    redisUrl: z.string().min(1),

    claudeApiToken: z.string().min(1),

    analyticsServiceBaseUrl: z.string().min(1),
    analyticsServiceApiToken: z.string().min(1),

    // required s3 variables
    s3Endpoint: z.string(),
    s3Region: z.string(),
    s3AccessKeyId: z.string(),
    s3SecretAccessKey: z.string(),
    s3ForcePathStyle: z.stringbool().default(true),
    s3DefaultBucket: z.string().min(1),
  })
  .transform(s3EnvAdapter);

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
