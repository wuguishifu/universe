import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  clipJobState,
  outcome,
  runCounts,
  runOptions,
  runSource,
  tokenUsage,
} from './validators';

export const clipperTables = {
  /** A Medal clip, by the hash of the original file. Its proxy is what gets analyzed. */
  clipperClips: defineTable({
    sha256: v.string(),
    /** Where the proxy is. */
    bucket: v.string(),
    key: v.string(),
    durationSec: v.number(),
    /** Where the original was when it was last submitted. */
    originalPath: v.string(),
    game: v.optional(v.string()),
    /** Medal's recording time, in the recording PC's local time (no offset). */
    recordedAt: v.optional(v.string()),
    fileId: v.optional(v.string()),
    fileGuid: v.optional(v.string()),
  }).index('by_sha256', ['sha256']),

  /** A batch of clips analyzed with the same options. */
  clipperRuns: defineTable({
    label: v.optional(v.string()),
    source: runSource,
    options: runOptions,
    /** clipper-service's PROMPT_VERSION when the run was created. */
    promptVersion: v.number(),
    /** 'finished' once nothing is queued or processing; adding clips makes it 'running' again. */
    status: v.union(
      v.literal('running'),
      v.literal('finished'),
      v.literal('cancelled'),
    ),
    /** How many of the run's clip jobs are in each state. */
    counts: runCounts,
    /** Of the done clip jobs, how many found something. */
    found: v.number(),
    /** Every Gemini call the run made, including attempts that failed. */
    spendUsd: v.number(),
    finishedAt: v.optional(v.number()),
  }),

  /** One clip analyzed in one run. */
  clipperClipJobs: defineTable({
    runId: v.id('clipperRuns'),
    clipId: v.id('clipperClips'),
    sha256: v.string(),
    state: clipJobState,
    /** Attempts started, including the current one. */
    attempts: v.number(),
    /** When state is 'done'. */
    outcome: v.optional(outcome),
    /** The last attempt's error, while retrying or once 'failed'. */
    error: v.optional(v.string()),
    /** Summed over every attempt. */
    usage: tokenUsage,
    costUsd: v.number(),
    /** Of the attempt that finished it, from starting to the answer. */
    latencyMs: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index('by_run_state', ['runId', 'state'])
    .index('by_run_clip', ['runId', 'clipId'])
    .index('by_clip', ['clipId'])
    .index('by_state_started', ['state', 'startedAt']),

  /** Gemini spend per UTC day, for CLIPPER_DAILY_SPEND_LIMIT_USD. */
  clipperDailySpend: defineTable({
    /** YYYY-MM-DD, UTC. */
    day: v.string(),
    spendUsd: v.number(),
  }).index('by_day', ['day']),
} as const;
