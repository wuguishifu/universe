import { paginationOptsValidator } from 'convex/server';
import { ConvexError, type Infer, v } from 'convex/values';
import { type Doc } from '../_generated/dataModel';
import {
  internalMutation,
  mutation,
  type MutationCtx,
  query,
} from '../_generated/server';
import { assertClipperSecret, clipperSecret } from './auth';
import { addDailySpend, dailySpend, moveClipJob, utcDay } from './helpers';
import { clipJobState, outcome, tokenUsage } from './validators';

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * An attempt takes a few minutes at most (two Gemini calls with a 3-minute timeout each), so a clip
 * job processing for longer than this has lost its worker: see failStuck.
 */
const STUCK_AFTER_MS = 30 * 60 * 1000;
const STUCK_BATCH = 100;

/**
 * Called by clipper-service as it picks up a clip job. Says whether to go ahead, and if so, with
 * what: the clip and its run's options are read here rather than carried in the queue, so a
 * cancelled run's jobs are skipped and a job never runs with stale options.
 */
export const start = mutation({
  args: {
    secret: clipperSecret,
    clipJobId: v.string(),
    /** CLIPPER_DAILY_SPEND_LIMIT_USD: once today's (UTC) spend reaches it, jobs wait for tomorrow. */
    dailySpendLimitUsd: v.number(),
  },
  handler: async (ctx, { secret, clipJobId, dailySpendLimitUsd }) => {
    assertClipperSecret(secret);
    const id = ctx.db.normalizeId('clipperClipJobs', clipJobId);
    const job = id && (await ctx.db.get('clipperClipJobs', id));
    if (!job) return { status: 'skip' as const, reason: 'no such clip job' };
    if (job.state !== 'queued' && job.state !== 'processing') {
      return { status: 'skip' as const, reason: `clip job is ${job.state}` };
    }
    const run = await ctx.db.get('clipperRuns', job.runId);
    const clip = await ctx.db.get('clipperClips', job.clipId);
    if (!run || !clip) {
      return { status: 'skip' as const, reason: 'run or clip is gone' };
    }
    if (run.status === 'cancelled') {
      await moveClipJob(ctx, job, 'cancelled', { finishedAt: Date.now() });
      return { status: 'skip' as const, reason: 'run was cancelled' };
    }

    const today = utcDay(Date.now());
    const spentUsd = await dailySpend(ctx, today);
    if (spentUsd >= dailySpendLimitUsd) {
      // Left processing by an attempt that was lost: it's waiting now, not running, so failStuck
      // mustn't take it for stuck while it waits for tomorrow.
      if (job.state === 'processing') await moveClipJob(ctx, job, 'queued');
      return {
        status: 'over_cap' as const,
        spentUsd,
        resumeAt: Date.parse(today) + DAY_MS,
      };
    }

    const started = { attempts: job.attempts + 1, startedAt: Date.now() };
    if (job.state === 'queued') {
      await moveClipJob(ctx, job, 'processing', started);
    } else {
      // A retry after the worker died mid-attempt: it never got to say so.
      await ctx.db.patch('clipperClipJobs', job._id, started);
    }
    return {
      status: 'proceed' as const,
      clipJobId: job._id,
      attempt: started.attempts,
      runSource: run.source,
      options: run.options,
      promptVersion: run.promptVersion,
      clip: {
        sha256: clip.sha256,
        bucket: clip.bucket,
        key: clip.key,
        durationSec: clip.durationSec,
        game: clip.game,
      },
    };
  },
});

export const complete = mutation({
  args: {
    secret: clipperSecret,
    clipJobId: v.id('clipperClipJobs'),
    outcome,
    /** This attempt's; added to earlier attempts'. */
    usage: tokenUsage,
    costUsd: v.number(),
    latencyMs: v.number(),
  },
  handler: async (
    ctx,
    { secret, clipJobId, outcome, usage, costUsd, latencyMs },
  ) => {
    assertClipperSecret(secret);
    const job = await getJob(ctx, clipJobId);
    if (job.state !== 'processing') {
      // Finished some other way while this attempt ran (e.g. a stalled attempt's twin).
      await addSpendOnly(ctx, job, usage, costUsd);
      return { runFinished: false, run: null };
    }
    const { run, finished } = await moveClipJob(
      ctx,
      job,
      'done',
      {
        outcome,
        error: undefined,
        usage: addUsage(job.usage, usage),
        costUsd: job.costUsd + costUsd,
        latencyMs,
        finishedAt: Date.now(),
      },
      { found: outcome.status === 'found' ? 1 : 0, spendUsd: costUsd },
    );
    await addDailySpend(ctx, costUsd);
    return { runFinished: finished, run };
  },
});

/**
 * An attempt failed. With `willRetry` the clip job goes back to queued for the next one. Only the
 * latest attempt can do that: a stalled attempt that BullMQ already gave to another worker can
 * still fail late, and mustn't undo the attempt that replaced it.
 */
export const fail = mutation({
  args: {
    secret: clipperSecret,
    clipJobId: v.id('clipperClipJobs'),
    /** The attempt `start` returned. */
    attempt: v.number(),
    error: v.string(),
    willRetry: v.boolean(),
    /** Gemini calls this attempt made before failing, if any. */
    usage: tokenUsage,
    costUsd: v.number(),
  },
  handler: async (
    ctx,
    { secret, clipJobId, attempt, error, willRetry, usage, costUsd },
  ) => {
    assertClipperSecret(secret);
    const job = await getJob(ctx, clipJobId);
    if (job.state !== 'processing' || job.attempts !== attempt) {
      await addSpendOnly(ctx, job, usage, costUsd);
      return { runFinished: false, run: null };
    }
    const run = await ctx.db.get('clipperRuns', job.runId);
    const to = !willRetry
      ? 'failed'
      : run?.status === 'cancelled'
        ? 'cancelled'
        : 'queued';
    const result = await moveClipJob(
      ctx,
      job,
      to,
      {
        error,
        usage: addUsage(job.usage, usage),
        costUsd: job.costUsd + costUsd,
        ...(to !== 'queued' && { finishedAt: Date.now() }),
      },
      { spendUsd: costUsd },
    );
    await addDailySpend(ctx, costUsd);
    return { runFinished: result.finished, run: result.run };
  },
});

/**
 * Fails clip jobs whose worker stopped reporting on them, so their runs can finish: one that died
 * on its last attempt, or couldn't save the result (Convex unreachable) and ran out of retries.
 * Runs every few minutes (crons.ts).
 */
export const failStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query('clipperClipJobs')
      .withIndex('by_state_started', (q) =>
        q
          .eq('state', 'processing')
          .lt('startedAt', Date.now() - STUCK_AFTER_MS),
      )
      .take(STUCK_BATCH);
    for (const job of stuck) {
      await moveClipJob(ctx, job, 'failed', {
        error: `No result after ${STUCK_AFTER_MS / 60_000} minutes; the worker running it was lost${job.error ? ` (last error: ${job.error})` : ''}`,
        finishedAt: Date.now(),
      });
    }
    return { failed: stuck.length };
  },
});

/** A run's clip jobs with their clips, optionally in one state. */
export const listByRun = query({
  args: {
    secret: clipperSecret,
    runId: v.id('clipperRuns'),
    state: v.optional(clipJobState),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { secret, runId, state, paginationOpts }) => {
    assertClipperSecret(secret);
    const page = await ctx.db
      .query('clipperClipJobs')
      .withIndex('by_run_state', (q) =>
        state ? q.eq('runId', runId).eq('state', state) : q.eq('runId', runId),
      )
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (job) => ({
          ...job,
          clip: await ctx.db.get('clipperClips', job.clipId),
        })),
      ),
    };
  },
});

/** Every run's result for one clip, newest first, to compare options on it. */
export const listByClip = query({
  args: { secret: clipperSecret, sha256: v.string() },
  handler: async (ctx, { secret, sha256 }) => {
    assertClipperSecret(secret);
    const clip = await ctx.db
      .query('clipperClips')
      .withIndex('by_sha256', (q) => q.eq('sha256', sha256))
      .unique();
    if (!clip) return null;
    const jobs = await ctx.db
      .query('clipperClipJobs')
      .withIndex('by_clip', (q) => q.eq('clipId', clip._id))
      .order('desc')
      .take(100);
    return {
      clip,
      jobs: await Promise.all(
        jobs.map(async (job) => ({
          ...job,
          run: await ctx.db.get('clipperRuns', job.runId),
        })),
      ),
    };
  },
});

async function getJob(
  ctx: MutationCtx,
  clipJobId: Doc<'clipperClipJobs'>['_id'],
): Promise<Doc<'clipperClipJobs'>> {
  const job = await ctx.db.get('clipperClipJobs', clipJobId);
  if (!job) throw new ConvexError({ code: 'not_found' as const });
  return job;
}

/** Counts a Gemini call toward a clip job, its run and today, without changing any state. */
async function addSpendOnly(
  ctx: MutationCtx,
  job: Doc<'clipperClipJobs'>,
  usage: Infer<typeof tokenUsage>,
  costUsd: number,
) {
  if (costUsd <= 0) return;
  await ctx.db.patch('clipperClipJobs', job._id, {
    usage: addUsage(job.usage, usage),
    costUsd: job.costUsd + costUsd,
  });
  const run = await ctx.db.get('clipperRuns', job.runId);
  if (run) {
    await ctx.db.patch('clipperRuns', run._id, {
      spendUsd: run.spendUsd + costUsd,
    });
  }
  await addDailySpend(ctx, costUsd);
}

function addUsage(
  a: Infer<typeof tokenUsage>,
  b: Infer<typeof tokenUsage>,
): Infer<typeof tokenUsage> {
  return {
    input: a.input + b.input,
    audioInput: a.audioInput + b.audioInput,
    output: a.output + b.output,
    thinking: a.thinking + b.thinking,
  };
}
