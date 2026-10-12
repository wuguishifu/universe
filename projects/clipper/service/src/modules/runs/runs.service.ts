import { Inject, Injectable } from '@nestjs/common';
import { type FunctionReturnType } from 'convex/server';
import { TrackingService } from '@platform/analytics-client-nest';
import { api } from '@platform/convex-contracts';
import {
  CLIPPER_PRIORITY,
  CLIPPER_QUEUE_CONFIG,
  type ClipInput,
  type ClipJob,
  type ClipJobState,
  type ClipperQueue,
  MAX_CLIPS_PER_REQUEST,
  type Run,
  type RunOptions,
  runOptionsSchema,
  type RunSource,
} from '@projects/clipper-contracts';
import { PROMPT_VERSION } from '../analysis/prompt';
import { ConvexService, convexErrorCode } from '../common/convex.service';

type Queued = { queued: number; alreadyInRun: number };

@Injectable()
export class RunsService {
  constructor(
    private readonly convex: ConvexService,
    private readonly trackingService: TrackingService,
    @Inject(CLIPPER_QUEUE_CONFIG.analyze.queueName)
    private readonly queue: ClipperQueue<'analyze'>,
  ) {}

  async create({
    options,
    source,
    label,
    clips,
  }: {
    options?: RunOptions;
    source: RunSource;
    label?: string;
    clips: ClipInput[];
  }): Promise<Queued & { runId: string }> {
    const runId = await this.createRun({ options, source, label });
    let queued;
    try {
      queued = await this.addClips(runId, clips);
    } catch (error) {
      // The caller never hears of this run, so retrying makes another. Cancel this one rather than
      // leave clip jobs queued in Convex that never made it into the queue.
      await this.convex
        .mutation(api.clipper.runs.cancel, { runId })
        .catch(() => undefined);
      throw error;
    }
    if (queued === 'not_found' || queued === 'cancelled') {
      throw new Error(`Run ${runId} was ${queued} as it was created`);
    }
    return { runId, ...queued };
  }

  /** Clips already in the run are skipped, so a retried request does no harm. */
  async addClips(
    runId: string,
    clips: ClipInput[],
  ): Promise<Queued | 'not_found' | 'cancelled'> {
    let added: {
      clipJobIds: string[];
      alreadyInRun: number;
      source: RunSource;
    };
    try {
      added = await this.convex.mutation(api.clipper.runs.addClips, {
        runId,
        clips,
      });
    } catch (error) {
      const code = convexErrorCode(error);
      if (code === 'not_found' || code === 'cancelled') return code;
      throw error;
    }

    // The job ID is the clip job's, so one that's already queued isn't added again.
    await this.queue.addBulk(
      added.clipJobIds.map((clipJobId) => ({
        name: CLIPPER_QUEUE_CONFIG.analyze.jobName,
        data: { clipJobId, runId },
        opts: { jobId: clipJobId, priority: CLIPPER_PRIORITY[added.source] },
      })),
    );
    return {
      queued: added.clipJobIds.length,
      alreadyInRun: added.alreadyInRun,
    };
  }

  /** A new run of the same clips with different options. */
  async rerun(
    runId: string,
    { options, label }: { options?: RunOptions; label?: string },
  ): Promise<(Queued & { runId: string }) | 'not_found'> {
    const run = await this.convex.query(api.clipper.runs.get, { runId });
    if (!run) return 'not_found';

    const newRunId = await this.createRun({ options, source: 'manual', label });
    const total: Queued = { queued: 0, alreadyInRun: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: FunctionReturnType<typeof api.clipper.runs.clips> =
        await this.convex.query(api.clipper.runs.clips, {
          runId: run._id,
          paginationOpts: { numItems: MAX_CLIPS_PER_REQUEST, cursor },
        });
      if (page.page.length > 0) {
        const queued = await this.addClips(newRunId, page.page);
        if (queued === 'not_found' || queued === 'cancelled') break;
        total.queued += queued.queued;
        total.alreadyInRun += queued.alreadyInRun;
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { runId: newRunId, ...total };
  }

  async get(runId: string): Promise<Run | null> {
    const run = await this.convex.query(api.clipper.runs.get, { runId });
    if (!run) return null;
    return {
      runId: run._id,
      label: run.label,
      source: run.source,
      options: runOptionsSchema.parse(run.options),
      promptVersion: run.promptVersion,
      status: run.status,
      counts: run.counts,
      found: run.found,
      spendUsd: run.spendUsd,
      createdAt: new Date(run._creationTime).toISOString(),
      finishedAt:
        run.finishedAt === undefined
          ? undefined
          : new Date(run.finishedAt).toISOString(),
    };
  }

  async clipJobs(
    runId: string,
    {
      state,
      cursor,
      limit,
    }: { state?: ClipJobState; cursor?: string; limit: number },
  ): Promise<{ clipJobs: ClipJob[]; cursor: string | null } | null> {
    const run = await this.convex.query(api.clipper.runs.get, { runId });
    if (!run) return null;
    const page = await this.convex.query(api.clipper.clipJobs.listByRun, {
      runId: run._id,
      state,
      paginationOpts: { numItems: limit, cursor: cursor ?? null },
    });
    return {
      clipJobs: page.page.flatMap(({ clip, ...job }) => {
        if (!clip) return [];
        return [
          {
            clipJobId: job._id,
            state: job.state,
            attempts: job.attempts,
            outcome: job.outcome,
            error: job.error,
            costUsd: job.costUsd,
            latencyMs: job.latencyMs,
            clip: {
              sha256: clip.sha256,
              durationSec: clip.durationSec,
              originalPath: clip.originalPath,
              game: clip.game,
              recordedAt: clip.recordedAt,
            },
          },
        ];
      }),
      cursor: page.isDone ? null : page.continueCursor,
    };
  }

  /**
   * Cancels the run in Convex, then takes its jobs out of the queue. Any the worker picks up
   * meanwhile are skipped when they start (AnalyzeClipProcessor checks with Convex first).
   */
  async cancel(
    runId: string,
  ): Promise<{ cancelledJobs: number } | 'not_found'> {
    let cancelled: { cancelledJobs: number };
    try {
      cancelled = await this.convex.mutation(api.clipper.runs.cancel, {
        runId,
      });
    } catch (error) {
      if (convexErrorCode(error) === 'not_found') return 'not_found';
      throw error;
    }

    // Collected before removing any, since removing shifts the pages.
    const jobs = [];
    for (const state of ['prioritized', 'waiting', 'delayed'] as const) {
      for (let start = 0; ; start += 1000) {
        const page = await this.queue.getJobs([state], start, start + 999);
        if (page.length === 0) break;
        jobs.push(...page.filter((job) => job?.data.runId === runId));
      }
    }
    await Promise.all(jobs.map((job) => job.remove().catch(() => undefined)));
    return cancelled;
  }

  private async createRun({
    options,
    source,
    label,
  }: {
    options?: RunOptions;
    source: RunSource;
    label?: string;
  }): Promise<string> {
    // Stored with every default filled in, so runs can be compared on any option.
    const resolved = runOptionsSchema.parse(options ?? {});
    const runId = await this.convex.mutation(api.clipper.runs.create, {
      options: resolved,
      promptVersion: PROMPT_VERSION,
      source,
      label,
    });
    this.trackingService.trackEvent({
      name: 'clipper_run-created',
      properties: {
        runId,
        source,
        model: resolved.model,
        media: resolved.media,
      },
      extra: { options: resolved, promptVersion: PROMPT_VERSION, label },
    });
    return runId;
  }
}
