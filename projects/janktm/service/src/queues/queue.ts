import { type Job, type JobsOptions } from 'bullmq';
import { z } from 'zod';

import {
  DEFAULT_QUEUE_CONFIG,
  type QueueConfig,
  type UniverseJobData,
  type UniverseJobResult,
} from '@libs/queue';

export const JANKTM_QUEUE_PREFIX = 'janktm-service-queue';

export const DERIVATIVE_KINDS = [
  'thumb',
  'display',
  'hover',
  'preview',
] as const;
export const derivativeKindSchema = z.enum(DERIVATIVE_KINDS);
export type DerivativeKind = z.infer<typeof derivativeKindSchema>;

const s3LocationSchema = z.object({ bucket: z.string(), key: z.string() });

export const scanResultSchema = z.object({
  albums: z.number(),
  items: z.number(),
  added: z.number(),
  queued: z.number(),
  deletedItems: z.number(),
  deletedAlbums: z.number(),
  /**
   * Files whose metadata couldn't (all) be read, by key. They're indexed anyway, with the best
   * capture time the rest gave, and processed: ffmpeg will say if they're really broken.
   */
  warnings: z.record(z.string(), z.string()),
});
export type ScanResult = z.infer<typeof scanResultSchema>;

export const reprocessSelectorSchema = z.union([
  z.object({ itemIds: z.array(z.string().min(1)).min(1).max(500) }),
  z
    .object({
      album: z.string().min(1).optional(),
      kind: z.enum(['photo', 'video']).optional(),
      all: z.literal(true).optional(),
    })
    .refine((s) => s.album || s.kind || s.all, {
      message: 'Select items by itemIds, album, kind, or all: true',
    }),
]);

export const JANKTM_QUEUE_CONFIG = {
  /**
   * Indexes the originals bucket (or one album folder) into Convex and queues processing for new
   * and changed files. `scannedAt` is fixed when the scan is queued, so a retry stamps the same.
   */
  scan: {
    queueName: 'album-scan',
    jobName: 'scan',
    jobSchema: z.object({
      album: z.string().min(1).optional(),
      scannedAt: z.number(),
    }),
    resultsSchema: scanResultSchema,
  },
  /** Gives the selected items new jobs and queues them. */
  reprocess: {
    queueName: 'album-reprocess',
    jobName: 'reprocess',
    jobSchema: z.object({
      selector: reprocessSelectorSchema,
      derivatives: z.array(derivativeKindSchema).min(1).optional(),
    }),
    resultsSchema: z.object({ queued: z.number() }),
  },
  /**
   * The parent of an item's ffmpeg job: saves what it made to Convex. Its ID is the item's job
   * token, so queueing the same job twice is a no-op.
   */
  complete: {
    queueName: 'album-complete',
    jobName: 'complete-item',
    jobSchema: z.object({
      itemId: z.string(),
      token: z.string(),
      /** Where each derivative the ffmpeg job makes goes, by its output name. */
      outputs: z.partialRecord(derivativeKindSchema, s3LocationSchema),
    }),
  },
} satisfies Record<string, QueueConfig>;

export type JanktmQueueConfig = typeof JANKTM_QUEUE_CONFIG;
export type JanktmQueueKey = keyof JanktmQueueConfig;
export type JanktmJobData<T extends JanktmQueueKey> = UniverseJobData<
  JanktmQueueConfig,
  T
>;
export type JanktmJob<T extends JanktmQueueKey> = Job<
  JanktmJobData<T>,
  UniverseJobResult<JanktmQueueConfig, T>
>;

export const JANKTM_JOB_OPTIONS: Record<JanktmQueueKey, JobsOptions> = {
  // A scan is idempotent, so a retry just redoes it; Convex or S3 being down is what it covers.
  scan: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { age: 30 * 24 * 60 * 60, count: 100 },
    removeOnFail: { age: 30 * 24 * 60 * 60, count: 100 },
  },
  reprocess: {
    ...DEFAULT_QUEUE_CONFIG,
    removeOnComplete: { age: 7 * 24 * 60 * 60, count: 100 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 100 },
  },
  complete: DEFAULT_QUEUE_CONFIG,
};
