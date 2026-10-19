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
    /** Bearer token for the API, which the app is set up with. */
    apiToken: z.string().min(16),
    redisUrl: z.string().min(1),
    universeDbConnectionString: z.string().min(1),

    // s3 variables
    s3Endpoint: z.string().min(1),
    s3Region: z.string().min(1),
    s3AccessKeyId: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3ForcePathStyle: z.stringbool(),
    /** Where tracks' audio and artwork go, at tracks/<youtube id>/. */
    musicS3Bucket: z.string().min(1).default('youtube-music'),

    ytdlpPath: z.string().default('yt-dlp'),
    ffmpegPath: z.string().default('ffmpeg'),
    /** Extra args for every yt-dlp call, e.g. `--cookies /path/to/cookies.txt`. */
    ytdlpExtraArgs: z.string().default(''),
    /** Longer videos fail instead of downloading, so a 10 hour livestream isn't queued by mistake. */
    maxDurationMinutes: z.coerce.number().positive().default(180),
    /** Downloads at once. */
    downloadConcurrency: z.coerce.number().int().positive().default(2),
  })
  .transform(s3EnvAdapter);

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
