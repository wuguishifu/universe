import { z } from 'zod';

const commaSeparated = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  debugLogging: z.stringbool().default(false),
  environment: z.enum(['development', 'production']).default('development'),
  redisUrl: z.string().min(1),

  discordToken: z.string().min(1),
  /**
   * Guilds to register slash commands in directly, which updates instantly (global commands
   * can take up to an hour to propagate). Leave empty in production to register globally.
   */
  discordDevGuildIds: commaSeparated,

  convexUrl: z.string().min(1),
  /** Must match RUBY_CONVEX_SECRET on the convex deployment. */
  rubyConvexSecret: z.string().min(16),

  /** transcription-service's base URL, e.g. http://bos-mac-mini:3002. */
  transcriptionServiceUrl: z.url(),
  transcriptionServiceApiToken: z.string().min(16),

  /** How long a speaker must be silent before their utterance is considered finished. */
  utteranceSilenceMs: z.coerce.number().int().positive().default(1000),
  /** Utterances shorter than this are dropped without being transcribed. */
  utteranceMinMs: z.coerce.number().int().nonnegative().default(500),
  /** Utterances longer than this are split into multiple jobs. */
  utteranceMaxMs: z.coerce.number().int().positive().default(30_000),
});
