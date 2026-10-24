import { z } from 'zod';
import {
  baseEnvironmentSchema,
  commaSeparated,
  createEnvironmentService,
  LocalEnvironmentModule,
  s3EnvAdapter,
} from '@libs/nest-common';
import { voiceBotId } from '@projects/jankbot-contracts';

/** Like commaSeparated, but missing means empty. */
const optionalCommaSeparated = z.string().default('').pipe(commaSeparated);

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema
  .extend({
    redisUrl: z.string().min(1),

    analyticsServiceBaseUrl: z.string().min(1),
    analyticsServiceApiToken: z.string().min(1),

    /** Used for Discord's HTTP API only; jankbot-gateway owns the gateway connection. */
    discordToken: z.string().min(1),
    /**
     * Guilds to register slash commands in directly, which updates instantly (global commands
     * can take up to an hour to propagate). Leave empty in production to register globally.
     */
    discordDevGuildIds: optionalCommaSeparated,

    /**
     * The voice bots' names (each gateway's NAME), e.g. "Bo,Mikey,Steven". /join picks the first free
     * one in this order, and these are the choices for /join and /leave's `bot` option.
     */
    voiceBots: optionalCommaSeparated
      .refine((names) => names.length > 0, 'List at least one voice bot')
      .refine(
        (names) => names.length <= 25,
        'Discord allows at most 25 choices',
      )
      .refine(
        (names) => new Set(names.map(voiceBotId)).size === names.length,
        'Voice bot names must be unique (ignoring case)',
      ),

    convexUrl: z.string().min(1),
    /** Must match RUBY_CONVEX_SECRET on the convex deployment. */
    rubyConvexSecret: z.string().min(16),

    /**
     * Utterances with less than this much audio above UTTERANCE_LOUDNESS_THRESHOLD_DBFS aren't
     * transcribed, which skips mic ticks and hiss that whisper turns into [BLANK_AUDIO]. 0 disables.
     */
    utteranceMinLoudMs: z.coerce.number().int().nonnegative().default(300),
    /** How loud (dBFS, so ≤ 0) a 20ms frame must be to count toward UTTERANCE_MIN_LOUD_MS. */
    utteranceLoudnessThresholdDbfs: z.coerce.number().max(0).default(-45),

    // s3 variables
    s3Endpoint: z.string().min(1),
    s3Region: z.string().min(1),
    s3AccessKeyId: z.string().min(1),
    s3SecretAccessKey: z.string().min(1),
    s3ForcePathStyle: z.stringbool(),
    recordingsS3Bucket: z.string().min(1),

    universeDbConnectionString: z.string().min(1),
  })
  .transform(s3EnvAdapter);

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
