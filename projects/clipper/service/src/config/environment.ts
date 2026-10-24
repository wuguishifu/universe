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
    apiToken: z.string().min(1),
    redisUrl: z.string().min(1),

    analyticsServiceBaseUrl: z.string().min(1),
    analyticsServiceApiToken: z.string().min(1),

    convexUrl: z.string().min(1),
    /** Must match CLIPPER_CONVEX_SECRET on the convex deployment. */
    clipperConvexSecret: z.string().min(16),

    geminiApiKey: z.string().min(1),
    /** Once today's (UTC) Gemini spend reaches this, clip jobs wait until tomorrow. */
    clipperDailySpendLimitUsd: z.coerce.number().positive().default(25),

    // s3 variables
    s3Endpoint: z.string().min(1),
    s3Region: z.string().min(1),
    s3AccessKeyId: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3ForcePathStyle: z.stringbool(),
    /** Where clips' proxies are uploaded. */
    clipperS3Bucket: z.string().min(1).default('clipper'),

    ffmpegPath: z.string().default('ffmpeg'),
  })
  .transform(s3EnvAdapter);

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
