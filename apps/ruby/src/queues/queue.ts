import {
  BullRootModuleOptions,
  SharedBullConfigurationFactory,
} from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { type Job, type JobsOptions } from 'bullmq';
import z from 'zod';
import {
  BullQueueModule,
  type QueueConfig,
  resolveRedisConnection,
  type UniverseJobData,
  type UniverseQueue,
} from '@universe/queue';
import { EnvironmentService } from '../environment/environment-service';

export const RUBY_QUEUE_CONFIG = {
  utterances: {
    queueName: 'utterances',
    jobName: 'process-utterance',
    jobSchema: z.object({
      /** Also the tungsten idempotency key, so a retried job never transcribes twice. */
      utteranceId: z.uuid(),
      guildId: z.string(),
      channelId: z.string(),
      userId: z.string(),
      /** Epoch ms when the user started speaking. */
      startedAt: z.number(),
      /**
       * Raw Opus packets (base64) as received from Discord: 48kHz stereo, 20ms each.
       * Compressed Opus keeps Redis payloads small (~50KB per 10s).
       */
      opusPackets: z.array(z.string()),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type RubyQueueConfig = typeof RUBY_QUEUE_CONFIG;
export type RubyQueueKey = keyof RubyQueueConfig;
export type RubyJobData<T extends RubyQueueKey> = UniverseJobData<
  RubyQueueConfig,
  T
>;
export type RubyQueue<T extends RubyQueueKey> = UniverseQueue<
  RubyQueueConfig,
  T
>;
export type RubyQueueJob<T extends RubyQueueKey> = Job<RubyJobData<T>>;

const UTTERANCE_JOB_OPTIONS: JobsOptions = {
  // Retries cover tungsten or Convex being briefly unreachable. Transcription is idempotent
  // (keyed by utteranceId), so a retry never transcribes twice; in the rare case that the
  // Convex mutation succeeded but its response was lost, the utterance counts twice.
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 60 * 60, count: 1000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1000 },
};

export const registerQueue = (queueKey: RubyQueueKey) =>
  BullQueueModule.register(RUBY_QUEUE_CONFIG, queueKey, UTTERANCE_JOB_OPTIONS);

@Injectable()
export class BullOptionsFactory implements SharedBullConfigurationFactory {
  constructor(private readonly environmentService: EnvironmentService) {}

  createSharedConfiguration(): BullRootModuleOptions {
    const connection = resolveRedisConnection(
      this.environmentService.environment.redisUrl,
    );

    return {
      prefix: 'ruby-queue',
      connection: {
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        family: connection.family,
      },
    };
  }
}
