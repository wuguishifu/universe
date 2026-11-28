import z from 'zod';

import { tmpdir } from 'os';
import path from 'path';

import {
  commaSeparated,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';
import { s3EnvAdapter } from '@libs/nest-s3';

const MINUTE_MS = 60 * 1000;

export const environmentSchema = z
  .object({
    redisUrl: z.string().min(1),
    ffmpegPath: z.string().default('ffmpeg'),
    ffprobePath: z.string().default('ffprobe'),

    /** Jobs' work dirs (`job-*`) go here; leftovers from a crash are deleted on start. */
    ffmpegWorkDir: z.string().default(path.join(tmpdir(), 'ffmpeg-worker')),
    /** Jobs run at once. */
    ffmpegConcurrency: z.coerce.number().int().min(1).default(2),
    /** For jobs that don't set `timeoutMs`. */
    ffmpegDefaultTimeoutMs: z.coerce
      .number()
      .int()
      .positive()
      .default(10 * MINUTE_MS),
    /** Jobs asking for longer fail. */
    ffmpegMaxTimeoutMs: z.coerce
      .number()
      .int()
      .positive()
      .default(120 * MINUTE_MS),
    /**
     * Encoders ffmpeg must have, checked on start so a wrong ffmpeg fails there rather than in
     * every job. Empty to check none (e.g. on a machine without VideoToolbox).
     */
    ffmpegRequiredEncoders: commaSeparated.default([
      'h264_videotoolbox',
      'hevc_videotoolbox',
    ]),
    /**
     * Filters ffmpeg must have, checked on start like the encoders. Homebrew's `ffmpeg` lacks
     * some that jobs use (e.g. `zscale` for HDR tone mapping); `ffmpeg-full` has them.
     */
    ffmpegRequiredFilters: commaSeparated.default([]),

    // MARK: s3 vars
    s3Endpoint: z.string(),
    s3Region: z.string(),
    s3AccessKeyId: z.string(),
    s3SecretAccessKey: z.string(),
    s3ForcePathStyle: z.stringbool(),
  })
  .refine((env) => env.ffmpegDefaultTimeoutMs <= env.ffmpegMaxTimeoutMs, {
    message: 'FFMPEG_DEFAULT_TIMEOUT_MS must be at most FFMPEG_MAX_TIMEOUT_MS',
  })
  .transform(s3EnvAdapter);

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
