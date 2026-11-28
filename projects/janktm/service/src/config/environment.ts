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
    /** Bearer token for every endpoint but health and version. */
    apiToken: z.string().min(16),
    /** Must be the ffmpeg worker's Redis: flows only work within one. */
    redisUrl: z.string().min(1),

    convexUrl: z.string().min(1),
    /** Must match JANKTM_CONVEX_SECRET on the convex deployment. */
    janktmConvexSecret: z.string().min(16),

    // s3 variables
    s3Endpoint: z.string().min(1),
    s3Region: z.string().min(1),
    s3AccessKeyId: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3ForcePathStyle: z.stringbool(),
    /** The album's originals: one top-level folder per album. Only read. */
    albumOriginalsBucket: z.string().min(1).default('janktm-album'),
    /** What's generated from them, under `<itemId>/`. */
    albumDerivedBucket: z.string().min(1).default('janktm-album-derived'),

    /** For capture times without an offset (most EXIF), e.g. "America/Los_Angeles". */
    albumDefaultTimeZone: z
      .string()
      .default('America/Los_Angeles')
      .refine(isTimeZone, 'Not an IANA time zone'),
    /** Files whose metadata a scan reads at once. */
    albumScanConcurrency: z.coerce.number().int().min(1).default(8),
  })
  .transform(s3EnvAdapter);

function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
