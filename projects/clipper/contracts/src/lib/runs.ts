import { z } from 'zod';

import { runOptionsSchema, runSourceSchema } from './options';
import { outcomeSchema } from './outcome';

export const clipJobStateSchema = z.enum([
  'queued',
  'processing',
  'done',
  'failed',
  'cancelled',
]);
export type ClipJobState = z.infer<typeof clipJobStateSchema>;

/** A run as GET /api/runs/:runId returns it. */
export const runSchema = z.object({
  runId: z.string(),
  label: z.string().optional(),
  source: runSourceSchema,
  options: runOptionsSchema,
  promptVersion: z.number(),
  /** 'finished' once nothing is queued or processing. */
  status: z.enum(['running', 'finished', 'cancelled']),
  /** How many of the run's clip jobs are in each state. */
  counts: z.record(clipJobStateSchema, z.number()),
  /** Of the done clip jobs, how many found something. */
  found: z.number(),
  spendUsd: z.number(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});
export type Run = z.infer<typeof runSchema>;

/** One clip's result in a run. */
export const clipJobSchema = z.object({
  clipJobId: z.string(),
  state: clipJobStateSchema,
  attempts: z.number(),
  /** When state is 'done'. */
  outcome: outcomeSchema.optional(),
  /** The last attempt's error, while retrying or once 'failed'. */
  error: z.string().optional(),
  costUsd: z.number(),
  latencyMs: z.number().optional(),
  clip: z.object({
    sha256: z.string(),
    durationSec: z.number(),
    originalPath: z.string(),
    game: z.string().optional(),
    recordedAt: z.string().optional(),
  }),
});
export type ClipJob = z.infer<typeof clipJobSchema>;
