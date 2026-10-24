import { WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { type FunctionReturnType } from 'convex/server';

import { UniverseProcessor } from '@libs/queue';
import { TrackingService } from '@platform/analytics-client-nest';
import { api, type Doc } from '@platform/convex-contracts';
import {
  CLIPPER_QUEUE_CONFIG,
  type ClipperQueueJob,
  NO_USAGE,
  runOptionsSchema,
} from '@projects/clipper-contracts';

import { EnvironmentService } from '../../config/environment';
import { ConvexService } from '../common/convex.service';

import { AnalysisError, AnalysisService } from './analysis.service';

/**
 * Clips analyzed at once. Each is mostly waiting on Gemini (10-30s), so this sets the pace: about
 * 15-30 requests a minute, far under Gemini's rate limits, while keeping the backlog moving.
 */
const CONCURRENCY = 6;
/** Once the daily cap lifts, waiting clip jobs start over this long rather than all at once. */
const CAP_RESUME_SPREAD_MS = 10 * 60 * 1000;

type Started = Extract<
  FunctionReturnType<typeof api.clipper.clipJobs.start>,
  { status: 'proceed' }
>;

@UniverseProcessor(CLIPPER_QUEUE_CONFIG, 'analyze', {
  concurrency: CONCURRENCY,
})
export class AnalyzeClipProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly logger = new Logger(AnalyzeClipProcessor.name);
  private readonly abortController = new AbortController();
  /** The last day the spend cap was reported, so each process reports it once a day. */
  private capReportedDay?: string;

  constructor(
    private readonly convex: ConvexService,
    private readonly analysisService: AnalysisService,
    private readonly environmentService: EnvironmentService,
    private readonly trackingService: TrackingService,
  ) {
    super();
  }

  onModuleDestroy() {
    this.abortController.abort(new Error('clipper-service is shutting down'));
  }

  override async process(
    job: ClipperQueueJob<'analyze'>,
    token?: string,
  ): Promise<void> {
    const { clipJobId, runId } = job.data;
    const dailySpendLimitUsd =
      this.environmentService.environment.clipperDailySpendLimitUsd;
    const start = await this.convex.mutation(api.clipper.clipJobs.start, {
      clipJobId,
      dailySpendLimitUsd,
    });
    if (start.status === 'skip') {
      this.logger.debug(`Skipping clip job ${clipJobId}: ${start.reason}`);
      return;
    }
    if (start.status === 'over_cap') {
      this.reportSpendCap(start.spentUsd, dailySpendLimitUsd);
      // Doesn't use up an attempt.
      await job.moveToDelayed(
        start.resumeAt + Math.random() * CAP_RESUME_SPREAD_MS,
        token,
      );
      throw new DelayedError();
    }

    const startedAt = Date.now();
    let analysis;
    try {
      // Checked when the run was created; this catches a model since dropped from MODEL_PRICING.
      const options = runOptionsSchema.safeParse(start.options);
      if (!options.success) {
        throw new AnalysisError(
          `The run's options are no longer valid: ${options.error.message}`,
          false,
          NO_USAGE,
          0,
        );
      }
      analysis = await this.analysisService.analyze({
        clip: start.clip,
        options: options.data,
        signal: this.abortController.signal,
      });
    } catch (error) {
      const unrecoverable = error instanceof AnalysisError && !error.retryable;
      await this.recordFailure(job, start, error, unrecoverable);
      if (unrecoverable) throw new UnrecoverableError(error.message);
      throw error;
    }
    const latencyMs = Date.now() - startedAt;

    const { outcome, usage, costUsd } = analysis;
    // If this throws, the attempt fails and BullMQ retries it; after the last, failStuck cleans up.
    const { runFinished, run } = await this.convex.mutation(
      api.clipper.clipJobs.complete,
      { clipJobId: start.clipJobId, outcome, usage, costUsd, latencyMs },
    );

    const segments = outcome.status === 'found' ? outcome.segments : [];
    this.logger.log(
      `Clip job ${clipJobId} (${start.clip.game ?? 'unknown game'}): ${
        segments.length
          ? segments
              .map((s) => `${s.startSec}-${s.endSec}s "${s.title}"`)
              .join(', ')
          : 'nothing found'
      } for $${costUsd.toFixed(4)} in ${(latencyMs / 1000).toFixed(1)}s`,
    );
    this.trackingService.trackEvent({
      name: 'clipper_job-completed',
      properties: {
        runId,
        clipJobId,
        model: start.options.model,
        media: start.options.media,
        outcome: outcome.status,
        segments: segments.length,
        game: start.clip.game ?? null,
      },
      extra: {
        options: start.options,
        promptVersion: start.promptVersion,
        attempt: start.attempt,
        usage,
        costUsd,
        latencyMs,
        calls: analysis.calls,
        mediaBytes: analysis.mediaBytes,
        mediaDurationSec: analysis.mediaDurationSec,
        clipDurationSec: start.clip.durationSec,
        topConfidence: Math.max(0, ...segments.map((s) => s.confidence)),
      },
    });
    if (runFinished && run) this.reportRunFinished(run);
  }

  private async recordFailure(
    job: ClipperQueueJob<'analyze'>,
    start: Started,
    error: unknown,
    unrecoverable: boolean,
  ) {
    const attempts = job.opts.attempts ?? 1;
    // attemptsMade counts the attempts before this one.
    const willRetry = !unrecoverable && job.attemptsMade + 1 < attempts;
    const message = describeError(error);
    const { usage, costUsd } =
      error instanceof AnalysisError ? error : { usage: NO_USAGE, costUsd: 0 };

    this.logger[willRetry ? 'warn' : 'error'](
      `Clip job ${job.data.clipJobId}: attempt ${job.attemptsMade + 1}/${attempts} failed: ${message}${willRetry ? ' (will retry)' : ' (giving up)'}`,
    );
    let runFinished = false;
    let run = null;
    try {
      ({ runFinished, run } = await this.convex.mutation(
        api.clipper.clipJobs.fail,
        {
          clipJobId: start.clipJobId,
          attempt: start.attempt,
          error: message,
          willRetry,
          usage,
          costUsd,
        },
      ));
    } catch (convexError) {
      // The attempt still fails. If it retries, starting it again puts it right in Convex; if not,
      // clipJobs.failStuck fails it once it's been processing too long.
      this.logger.error(
        `Couldn't record clip job ${job.data.clipJobId}'s failure: ${describeError(convexError)}`,
      );
    }
    this.trackingService.trackEvent({
      name: 'clipper_job-failed',
      properties: {
        runId: job.data.runId,
        clipJobId: job.data.clipJobId,
        model: start.options.model,
        media: start.options.media,
        final: !willRetry,
      },
      extra: {
        attempt: job.attemptsMade + 1,
        error: message,
        usage,
        costUsd,
      },
    });
    if (runFinished && run) this.reportRunFinished(run);
  }

  private reportRunFinished(run: Doc<'clipperRuns'>) {
    this.logger.log(
      `Run ${run._id}${run.label ? ` (${run.label})` : ''} finished: ${run.found}/${run.counts.done} found something, ${run.counts.failed} failed, $${run.spendUsd.toFixed(2)}`,
    );
    this.trackingService.trackEvent({
      name: 'clipper_run-finished',
      properties: {
        runId: run._id,
        source: run.source,
        model: run.options.model,
        media: run.options.media,
      },
      extra: {
        label: run.label,
        counts: run.counts,
        found: run.found,
        spendUsd: run.spendUsd,
        durationMs: (run.finishedAt ?? Date.now()) - run._creationTime,
        promptVersion: run.promptVersion,
      },
    });
  }

  private reportSpendCap(spentUsd: number, limitUsd: number) {
    const day = new Date().toISOString().slice(0, 10);
    if (this.capReportedDay === day) return;
    this.capReportedDay = day;
    this.logger.warn(
      `Spent $${spentUsd.toFixed(2)} of today's $${limitUsd} limit; clip jobs wait until tomorrow (UTC)`,
    );
    this.trackingService.trackEvent({
      name: 'clipper_spend_cap-hit',
      properties: { day },
      extra: { spentUsd, limitUsd },
    });
  }
}

/** Network errors (e.g. S3 refusing connections) can be AggregateErrors with no message of their own. */
function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map(describeError).join('; ');
  }
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
