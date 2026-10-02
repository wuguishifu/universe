import { type Job, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import {
  type QueueConfig,
  type UniverseJobData,
  type UniverseQueue,
} from '@libs/queue';

/** Redis key prefix for every jankbot queue. gateway and core must agree on it to see the same jobs. */
export const JANKBOT_QUEUE_PREFIX = 'jankbot-queue';

/** Discord sends 20ms Opus frames. */
export const OPUS_FRAME_MS = 20;

/** Interaction tokens expire 15 minutes after the interaction is created; replying after that fails. */
export const INTERACTION_TOKEN_TTL_MS = 15 * 60 * 1000;

const commandOptionValue = z.union([z.string(), z.number(), z.boolean()]);

export const JANKBOT_QUEUE_CONFIG = {
  /** gateway → core: audio captured from a voice channel, to be transcribed. */
  utterances: {
    queueName: 'utterances',
    jobName: 'process-utterance',
    jobSchema: z.object({
      /** Also the transcription-service idempotency key, so a retried job never transcribes twice. */
      utteranceId: z.uuid(),
      guildId: z.string(),
      channelId: z.string(),
      userId: z.string(),
      /** Epoch ms when the user started speaking. */
      startedAt: z.number(),
      /**
       * Raw Opus packets (base64) as received from Discord: 48kHz stereo, OPUS_FRAME_MS each.
       * Compressed Opus keeps Redis payloads small (~50KB per 10s).
       */
      opusPackets: z.array(z.string()),
    }),
  },
  /**
   * gateway → core: a slash command the gateway has already deferred. core answers it by editing
   * the deferred reply through the interaction webhook, which needs no gateway connection.
   */
  interactions: {
    queueName: 'interactions',
    jobName: 'process-interaction',
    jobSchema: z.object({
      interactionId: z.string(),
      applicationId: z.string(),
      /** Interaction webhook token; valid for INTERACTION_TOKEN_TTL_MS after receivedAt. */
      token: z.string(),
      /** Epoch ms when Discord created the interaction. */
      receivedAt: z.number(),
      guildId: z.string().nullable(),
      channelId: z.string().nullable(),
      userId: z.string(),
      /** The caller's voice channel when the command was run, from the gateway's cache. */
      voiceChannelId: z.string().nullable(),
      commandName: z.string(),
      subcommandGroup: z.string().nullable(),
      subcommand: z.string().nullable(),
      /** The leaf options by name. User, channel and role options are their IDs. */
      options: z.record(z.string(), commandOptionValue),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type JankbotQueueConfig = typeof JANKBOT_QUEUE_CONFIG;
export type JankbotQueueKey = keyof JankbotQueueConfig;
export type JankbotJobData<T extends JankbotQueueKey> = UniverseJobData<
  JankbotQueueConfig,
  T
>;
export type JankbotQueue<T extends JankbotQueueKey> = UniverseQueue<
  JankbotQueueConfig,
  T
>;
export type JankbotQueueJob<T extends JankbotQueueKey> = Job<JankbotJobData<T>>;

/** Job defaults are set by whichever side adds the job (the gateway), but both register the queue with them. */
export const JANKBOT_JOB_OPTIONS = {
  // Retries cover transcription-service or Convex being briefly unreachable. Transcription is idempotent
  // (keyed by utteranceId), so a retry never transcribes twice; in the rare case that the
  // Convex mutation succeeded but its response was lost, the utterance counts twice.
  utterances: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 60 * 60, count: 1000 },
    removeOnFail: { age: 24 * 60 * 60, count: 1000 },
  },
  // Someone is watching a "thinking..." message, so retry quickly and give up well inside the token's lifetime.
  interactions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { age: 60 * 60, count: 1000 },
    removeOnFail: { age: 24 * 60 * 60, count: 1000 },
  },
} satisfies Record<JankbotQueueKey, JobsOptions>;
