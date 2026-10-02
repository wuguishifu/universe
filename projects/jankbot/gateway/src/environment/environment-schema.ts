import { z } from 'zod';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  debugLogging: z.stringbool().default(false),
  environment: z.enum(['development', 'production']).default('development'),
  redisUrl: z.string().min(1),

  discordToken: z.string().min(1),

  /**
   * Every gateway is a voice bot. The primary one (exactly one) is also the bot the slash commands
   * belong to: it receives every command and forwards it to core. Workers only join and leave
   * channels when core tells them to.
   */
  role: z.enum(['primary', 'worker']),
  /** This voice bot's name, e.g. "Mikey". Must be listed in core's VOICE_BOTS and unique among gateways. */
  name: z.string().trim().min(1),

  /** How long a speaker must be silent before their utterance is considered finished. */
  utteranceSilenceMs: z.coerce.number().int().positive().default(1000),
  /** Utterances shorter than this are dropped without being transcribed. */
  utteranceMinMs: z.coerce.number().int().nonnegative().default(500),
  /** Utterances longer than this are split into multiple jobs. */
  utteranceMaxMs: z.coerce.number().int().positive().default(30_000),

  /** The bot leaves a voice channel after being the only (non-bot) member for this long. */
  voiceIdleTimeoutMs: z.coerce.number().int().positive().default(300_000),
});
