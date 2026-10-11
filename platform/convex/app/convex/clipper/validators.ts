import { v, type Infer } from 'convex/values';

// Mirrors of projects/clipper/contracts' zod schemas, which clipper-service validates requests
// against before they get here. Kept separate so the Convex bundle doesn't pull in the contracts'
// Node dependencies; clipper-service passing contract types to these functions keeps them in step.

export const clipInput = v.object({
  sha256: v.string(),
  bucket: v.string(),
  key: v.string(),
  durationSec: v.number(),
  originalPath: v.string(),
  game: v.optional(v.string()),
  recordedAt: v.optional(v.string()),
  fileId: v.optional(v.string()),
  fileGuid: v.optional(v.string()),
});

/** RunOptions after defaults are applied. */
export const runOptions = v.object({
  model: v.string(),
  media: v.union(v.literal('video'), v.literal('audio')),
  mediaResolution: v.union(
    v.literal('low'),
    v.literal('medium'),
    v.literal('high'),
  ),
  fps: v.number(),
  tailSeconds: v.optional(v.number()),
  thinkingLevel: v.union(
    v.literal('minimal'),
    v.literal('low'),
    v.literal('medium'),
    v.literal('high'),
  ),
  instructions: v.optional(v.string()),
});

export const runSource = v.union(v.literal('manual'), v.literal('auto'));

export const segment = v.object({
  startSec: v.number(),
  endSec: v.number(),
  title: v.string(),
  category: v.union(
    v.literal('funny'),
    v.literal('clutch'),
    v.literal('skill'),
    v.literal('fail'),
    v.literal('chaos'),
    v.literal('other'),
  ),
  confidence: v.number(),
  reasoning: v.string(),
});

export const outcome = v.union(
  v.object({ status: v.literal('found'), segments: v.array(segment) }),
  v.object({ status: v.literal('not_found'), reason: v.string() }),
);

export const tokenUsage = v.object({
  input: v.number(),
  audioInput: v.number(),
  output: v.number(),
  thinking: v.number(),
});

export const clipJobState = v.union(
  v.literal('queued'),
  v.literal('processing'),
  v.literal('done'),
  v.literal('failed'),
  v.literal('cancelled'),
);
export type ClipJobState = Infer<typeof clipJobState>;

export const runCounts = v.object({
  queued: v.number(),
  processing: v.number(),
  done: v.number(),
  failed: v.number(),
  cancelled: v.number(),
});
export type RunCounts = Infer<typeof runCounts>;
