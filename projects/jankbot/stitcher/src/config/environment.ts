import { z } from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';
import { s3EnvAdapter } from '@libs/nest-s3';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema
  .extend({
    /** Must be the Redis jankbot's other apps use: stitch jobs come from the gateway. */
    redisUrl: z.string().min(1),

    analyticsServiceBaseUrl: z.string().min(1),
    analyticsServiceApiToken: z.string().min(1),

    // s3 variables
    s3Endpoint: z.string().min(1),
    s3Region: z.string().min(1),
    s3AccessKeyId: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3ForcePathStyle: z.stringbool(),
    /** Where core uploads utterances, and where compilations are written. */
    recordingsS3Bucket: z.string().min(1),

    universeDbConnectionString: z.string().min(1),

    ffmpegPath: z.string().default('ffmpeg'),
    /**
     * How long after a session ends to keep waiting for its utterances to be transcribed (e.g. while
     * the transcription worker is behind or down) before stitching what's there.
     */
    stitchMaxWaitMs: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(60 * 60 * 1000),
  })
  .transform(s3EnvAdapter);

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
