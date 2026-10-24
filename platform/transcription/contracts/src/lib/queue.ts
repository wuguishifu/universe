import { Job } from 'bullmq';
import z from 'zod';

import {
  UniverseJobData,
  UniverseJobResult,
  UniverseQueue,
  type QueueConfig,
} from '@libs/queue';

import {
  audioSourceSchema,
  transcriptionOptionsSchema,
  transcriptSchema,
} from './transcript';

export const TRANSCRIPTION_QUEUE_PREFIX = 'transcription-worker-queue';

export const TRANSCRIPTION_QUEUE_CONFIG = {
  transcribe: {
    queueName: 'transcription-queue',
    jobName: 'transcribe',
    jobSchema: z.object({
      source: audioSourceSchema,
      options: transcriptionOptionsSchema.optional(),
    }),
    resultsSchema: z.object({
      transcript: transcriptSchema,
      analytics: z.object({
        waitTimeMs: z.number(),
        ffmpegProcessingTimeMs: z.number(),
        whisperProcessingTimeMs: z.number(),
        /** Only when the request set `diarize`. Runs at the same time as whisper. */
        diarizeProcessingTimeMs: z.number().optional(),
        audioDurationMs: z.number(),
        realtimeFactor: z.number(),
      }),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type TranscriptionQueueConfig = typeof TRANSCRIPTION_QUEUE_CONFIG;
export type TranscriptionQueueKey = keyof TranscriptionQueueConfig;
export type TranscriptionJobData<T extends TranscriptionQueueKey> =
  UniverseJobData<TranscriptionQueueConfig, T>;
export type TranscriptionQueue<T extends TranscriptionQueueKey> = UniverseQueue<
  TranscriptionQueueConfig,
  T
>;
export type TranscriptionJob<T extends TranscriptionQueueKey> = Job<
  TranscriptionJobData<T>
>;
export type TranscriptionJobResult<T extends TranscriptionQueueKey> =
  UniverseJobResult<TranscriptionQueueConfig, T>;
