import { paginationOptsValidator } from 'convex/server';
import { ConvexError, type Infer, v } from 'convex/values';

import { internal } from '../_generated/api';
import { type Id } from '../_generated/dataModel';
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
} from '../_generated/server';

import { assertClipperSecret, clipperSecret } from './auth';
import { EMPTY_COUNTS, moveClipJob } from './helpers';
import { clipInput, runOptions, runSource } from './validators';

/** Cancelled clip jobs per transaction; a bigger run's cancel continues in scheduled ones. */
const CANCEL_BATCH = 500;

export const create = mutation({
  args: {
    secret: clipperSecret,
    options: runOptions,
    promptVersion: v.number(),
    source: runSource,
    label: v.optional(v.string()),
  },
  handler: async (ctx, { secret, ...run }) => {
    assertClipperSecret(secret);
    return await ctx.db.insert('clipperRuns', {
      ...run,
      status: 'running',
      counts: EMPTY_COUNTS,
      found: 0,
      spendUsd: 0,
    });
  },
});

/**
 * Adds clips to a run, saving or updating each clip by its hash. Returns the clip jobs to queue:
 * the new ones, and ones already in the run that are still queued (so a retried request queues
 * whatever the first try didn't get to; queueing one twice is a no-op).
 */
export const addClips = mutation({
  args: {
    secret: clipperSecret,
    runId: v.string(),
    clips: v.array(clipInput),
  },
  handler: async (ctx, { secret, runId: rawRunId, clips }) => {
    assertClipperSecret(secret);
    const runId = ctx.db.normalizeId('clipperRuns', rawRunId);
    const run = runId && (await ctx.db.get('clipperRuns', runId));
    if (!run) throw new ConvexError({ code: 'not_found' as const });
    if (run.status === 'cancelled') {
      throw new ConvexError({ code: 'cancelled' as const });
    }

    const toQueue: Id<'clipperClipJobs'>[] = [];
    let added = 0;
    let alreadyInRun = 0;
    for (const clip of clips) {
      const clipId = await upsertClip(ctx, clip);
      const existing = await ctx.db
        .query('clipperClipJobs')
        .withIndex('by_run_clip', (q) =>
          q.eq('runId', run._id).eq('clipId', clipId),
        )
        .unique();
      if (existing) {
        alreadyInRun++;
        if (existing.state === 'queued') toQueue.push(existing._id);
        continue;
      }
      toQueue.push(
        await ctx.db.insert('clipperClipJobs', {
          runId: run._id,
          clipId,
          sha256: clip.sha256,
          state: 'queued',
          attempts: 0,
          usage: { input: 0, audioInput: 0, output: 0, thinking: 0 },
          costUsd: 0,
        }),
      );
      added++;
    }

    if (added > 0) {
      await ctx.db.patch('clipperRuns', run._id, {
        counts: { ...run.counts, queued: run.counts.queued + added },
        status: 'running',
        finishedAt: undefined,
      });
    }
    return { clipJobIds: toQueue, added, alreadyInRun, source: run.source };
  },
});

async function upsertClip(
  ctx: MutationCtx,
  clip: Infer<typeof clipInput>,
): Promise<Id<'clipperClips'>> {
  const existing = await ctx.db
    .query('clipperClips')
    .withIndex('by_sha256', (q) => q.eq('sha256', clip.sha256))
    .unique();
  if (!existing) return await ctx.db.insert('clipperClips', clip);
  // The latest submission knows best where the original is now.
  await ctx.db.patch('clipperClips', existing._id, clip);
  return existing._id;
}

/**
 * Stops a run: its queued clip jobs are cancelled (in batches, for big runs), and clip jobs that
 * start later are skipped. Clip jobs already processing finish.
 */
export const cancel = mutation({
  args: { secret: clipperSecret, runId: v.string() },
  handler: async (ctx, { secret, runId: rawRunId }) => {
    assertClipperSecret(secret);
    const runId = ctx.db.normalizeId('clipperRuns', rawRunId);
    const run = runId && (await ctx.db.get('clipperRuns', runId));
    if (!run) throw new ConvexError({ code: 'not_found' as const });

    if (run.status !== 'running') return { cancelledJobs: 0 };

    await ctx.db.patch('clipperRuns', run._id, { status: 'cancelled' });
    await ctx.scheduler.runAfter(0, internal.clipper.runs.cancelQueued, {
      runId: run._id,
    });
    return { cancelledJobs: run.counts.queued };
  },
});

export const cancelQueued = internalMutation({
  args: { runId: v.id('clipperRuns') },
  handler: async (ctx, { runId }) => {
    const jobs = await ctx.db
      .query('clipperClipJobs')
      .withIndex('by_run_state', (q) =>
        q.eq('runId', runId).eq('state', 'queued'),
      )
      .take(CANCEL_BATCH);
    for (const job of jobs) {
      await moveClipJob(ctx, job, 'cancelled', { finishedAt: Date.now() });
    }
    if (jobs.length === CANCEL_BATCH) {
      await ctx.scheduler.runAfter(0, internal.clipper.runs.cancelQueued, {
        runId,
      });
    }
  },
});

export const get = query({
  args: { secret: clipperSecret, runId: v.string() },
  handler: async (ctx, { secret, runId: rawRunId }) => {
    assertClipperSecret(secret);
    const runId = ctx.db.normalizeId('clipperRuns', rawRunId);
    return runId ? await ctx.db.get('clipperRuns', runId) : null;
  },
});

/** Newest first. */
export const list = query({
  args: { secret: clipperSecret, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { secret, paginationOpts }) => {
    assertClipperSecret(secret);
    return await ctx.db
      .query('clipperRuns')
      .order('desc')
      .paginate(paginationOpts);
  },
});

/** A page of a run's clips, as they'd be submitted (for rerunning them). */
export const clips = query({
  args: {
    secret: clipperSecret,
    runId: v.id('clipperRuns'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { secret, runId, paginationOpts }) => {
    assertClipperSecret(secret);
    const page = await ctx.db
      .query('clipperClipJobs')
      .withIndex('by_run_clip', (q) => q.eq('runId', runId))
      .paginate(paginationOpts);
    const clips = await Promise.all(
      page.page.map((job) => ctx.db.get('clipperClips', job.clipId)),
    );
    return {
      ...page,
      page: clips.flatMap((clip) => {
        if (!clip) return [];
        return [
          {
            sha256: clip.sha256,
            bucket: clip.bucket,
            key: clip.key,
            durationSec: clip.durationSec,
            originalPath: clip.originalPath,
            game: clip.game,
            recordedAt: clip.recordedAt,
            fileId: clip.fileId,
            fileGuid: clip.fileGuid,
          },
        ];
      }),
    };
  },
});
