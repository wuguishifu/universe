import { type Doc } from '../_generated/dataModel';
import { type MutationCtx } from '../_generated/server';
import { type ClipJobState, type RunCounts } from './validators';

export const EMPTY_COUNTS: RunCounts = {
  queued: 0,
  processing: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
};

export function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Moves a clip job to `to` and its run's counts with it. Finishes the run once nothing in it is
 * queued or processing. Returns the run as it is now, and whether this finished it.
 */
export async function moveClipJob(
  ctx: MutationCtx,
  job: Doc<'clipperClipJobs'>,
  to: ClipJobState,
  patch: Partial<Doc<'clipperClipJobs'>> = {},
  runPatch: { found?: number; spendUsd?: number } = {},
): Promise<{ run: Doc<'clipperRuns'>; finished: boolean }> {
  const run = await ctx.db.get('clipperRuns', job.runId);
  if (!run) throw new Error(`Run ${job.runId} is gone`);

  await ctx.db.patch('clipperClipJobs', job._id, { ...patch, state: to });
  const counts = { ...run.counts };
  counts[job.state] -= 1;
  counts[to] += 1;
  const finished =
    run.status === 'running' && counts.queued === 0 && counts.processing === 0;
  const updated: Partial<Doc<'clipperRuns'>> = {
    counts,
    found: run.found + (runPatch.found ?? 0),
    spendUsd: run.spendUsd + (runPatch.spendUsd ?? 0),
    ...(finished && { status: 'finished', finishedAt: Date.now() }),
  };
  await ctx.db.patch('clipperRuns', run._id, updated);
  return { run: { ...run, ...updated }, finished };
}

/** Counts a Gemini call's cost toward today's total (see CLIPPER_DAILY_SPEND_LIMIT_USD). */
export async function addDailySpend(ctx: MutationCtx, costUsd: number) {
  if (costUsd <= 0) return;
  const day = utcDay(Date.now());
  const row = await ctx.db
    .query('clipperDailySpend')
    .withIndex('by_day', (q) => q.eq('day', day))
    .unique();
  if (row) {
    await ctx.db.patch('clipperDailySpend', row._id, {
      spendUsd: row.spendUsd + costUsd,
    });
  } else {
    await ctx.db.insert('clipperDailySpend', { day, spendUsd: costUsd });
  }
}

export async function dailySpend(
  ctx: MutationCtx,
  day: string,
): Promise<number> {
  const row = await ctx.db
    .query('clipperDailySpend')
    .withIndex('by_day', (q) => q.eq('day', day))
    .unique();
  return row?.spendUsd ?? 0;
}
