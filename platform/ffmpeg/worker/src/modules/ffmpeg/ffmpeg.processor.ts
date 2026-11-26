import { WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';

import { stat } from 'fs/promises';

import { UniverseProcessor } from '@libs/queue';
import {
  FFMPEG_QUEUE_CONFIG,
  ffmpegRequestSchema,
  parseArg,
  substituteArg,
  type FfmpegJob,
  type FfmpegJobResult,
  type FfmpegOutputResult,
  type FfmpegRequest,
} from '@platform/ffmpeg-contracts';

import { EnvironmentService } from '../../config/environment';

import {
  FfmpegExitError,
  FfmpegTimeoutError,
  isTransientFailure,
} from './errors';
import { FfmpegService } from './ffmpeg.service';
import { FilesService } from './files.service';
import { LocalPaths } from './local-paths';
import { ProgressTracker, stepFraction } from './progress';
import { WorkDirService } from './work-dir.service';

@UniverseProcessor(FFMPEG_QUEUE_CONFIG, 'run')
export class FfmpegProcessor
  extends WorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(FfmpegProcessor.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly ffmpeg: FfmpegService,
    private readonly files: FilesService,
    private readonly workDirs: WorkDirService,
  ) {
    super();
  }

  /** Set here rather than in the decorator, so it comes from the validated environment. */
  onApplicationBootstrap() {
    this.worker.concurrency =
      this.environmentService.environment.ffmpegConcurrency;
  }

  override async process(
    job: FfmpegJob<'run'>,
  ): Promise<FfmpegJobResult<'run'>> {
    const startedAt = Date.now();
    // Jobs are checked when they're added too, but anything can write to Redis.
    const parsed = ffmpegRequestSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Invalid ffmpeg request:\n${z.prettifyError(parsed.error)}`,
      );
    }
    const request = parsed.data;
    const { ffmpegDefaultTimeoutMs, ffmpegMaxTimeoutMs } =
      this.environmentService.environment;
    const timeoutMs = request.timeoutMs ?? ffmpegDefaultTimeoutMs;
    if (timeoutMs > ffmpegMaxTimeoutMs) {
      throw new UnrecoverableError(
        `timeoutMs ${timeoutMs} is over this worker's cap of ${ffmpegMaxTimeoutMs}ms`,
      );
    }

    const progress = new ProgressTracker(request.steps.length, (percent) => {
      job.updateProgress(percent).catch((error: unknown) => {
        this.logger.warn(
          `Job ${job.id}: couldn't report progress: ${String(error)}`,
        );
      });
    });
    const log = (line: string) =>
      job.log(line).catch((error: unknown) => {
        this.logger.warn(
          `Job ${job.id}: couldn't write its log: ${String(error)}`,
        );
      });

    const workDir = await this.workDirs.create();
    try {
      let paths: LocalPaths;
      try {
        paths = new LocalPaths(workDir, request);
      } catch (error) {
        throw new UnrecoverableError(
          error instanceof Error ? error.message : String(error),
        );
      }

      // MARK: download
      progress.download(0);
      const downloadStart = Date.now();
      const inputs = Object.entries(request.inputs);
      let downloaded = 0;
      await Promise.all(
        inputs.map(async ([name, input]) => {
          await this.files.download(input, paths.input(name));
          progress.download(++downloaded / inputs.length);
        }),
      );
      const downloadMs = Date.now() - downloadStart;
      const inputDurations = await this.inputDurations(request, paths);

      // MARK: steps
      const deadline = Date.now() + timeoutMs;
      const stepsMs: number[] = [];
      for (const [index, step] of request.steps.entries()) {
        const label = `step ${index + 1}/${request.steps.length}`;
        const args = step.args.map((arg) =>
          substituteArg(arg, (placeholder) => paths.resolve(placeholder)),
        );
        const expectedMs =
          step.expectedDurationMs ??
          maxOrUndefined(
            readInputs(step.args).map((name) => inputDurations.get(name)),
          );

        progress.step(index, 0);
        await log(
          `${label}: ffmpeg ${args.map((arg) => quote(paths.relative(arg))).join(' ')}`,
        );
        const stepStart = Date.now();
        try {
          const remainingMs = deadline - stepStart;
          if (remainingMs <= 0) {
            throw new FfmpegTimeoutError(timeoutMs, '');
          }
          await this.ffmpeg.run({
            args,
            cwd: workDir,
            timeoutMs: remainingMs,
            onOutTime: (ms) =>
              progress.step(index, stepFraction(ms, expectedMs)),
          });
        } catch (error) {
          const elapsed = seconds(Date.now() - stepStart);
          if (error instanceof FfmpegExitError) {
            await log(
              `${label}: ${error.message} after ${elapsed}:\n${error.stderrTail}`,
            );
            const message = `${label}: ${error.message}:\n${error.stderrTail}`;
            throw isTransientFailure(error.stderrTail)
              ? new Error(message)
              : new UnrecoverableError(message);
          }
          if (error instanceof FfmpegTimeoutError) {
            await log(
              `${label}: killed after ${elapsed}, past the job's ${timeoutMs}ms timeout:\n${error.stderrTail}`,
            );
            throw new UnrecoverableError(
              `${label} ran past the job's ${timeoutMs}ms timeout:\n${error.stderrTail}`,
            );
          }
          // Couldn't start ffmpeg, or the worker is shutting down: worth another attempt.
          await log(
            `${label}: ${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
        stepsMs.push(Date.now() - stepStart);
        await log(`${label}: done in ${seconds(Date.now() - stepStart)}`);
      }

      // MARK: outputs
      const outputs = Object.entries(request.outputs);
      for (const [name] of outputs) {
        const written = await stat(paths.output(name)).catch(() => null);
        if (!written?.isFile()) {
          throw new UnrecoverableError(
            `The steps finished without writing output "${name}"`,
          );
        }
      }
      progress.upload(0);
      const probeStart = Date.now();
      const probes = await Promise.all(
        outputs.map(([name]) => this.ffmpeg.probe(paths.output(name))),
      );
      const probeMs = Date.now() - probeStart;

      const uploadStart = Date.now();
      let uploaded = 0;
      const results = await Promise.all(
        outputs.map(
          async ([name, output], i): Promise<[string, FfmpegOutputResult]> => {
            const { sizeBytes, contentType } = await this.files.upload(
              output,
              paths.output(name),
            );
            progress.upload(++uploaded / outputs.length);
            return [
              name,
              {
                bucket: output.bucket,
                key: output.key,
                contentType,
                sizeBytes,
                probe: probes[i],
              },
            ];
          },
        ),
      );
      const uploadMs = Date.now() - uploadStart;
      progress.done();

      const totalMs = Date.now() - startedAt;
      await log(
        `uploaded ${results.map(([name, r]) => `${name} (${r.sizeBytes} bytes)`).join(', ')}`,
      );
      this.logger.log(
        `Job ${job.id}: ${request.steps.length} step(s) in ${seconds(stepsMs.reduce((a, b) => a + b, 0))}, ${seconds(totalMs)} in all`,
      );
      return {
        outputs: Object.fromEntries(results),
        analytics: {
          waitTimeMs: (job.processedOn ?? startedAt) - job.timestamp,
          downloadMs,
          stepsMs,
          probeMs,
          uploadMs,
          totalMs,
        },
      };
    } finally {
      await this.workDirs.remove(workDir);
    }
  }

  /**
   * Probes the inputs that steps without `expectedDurationMs` read, for their progress. A file
   * ffprobe can't read is left out; ffmpeg will report what's wrong with it.
   */
  private async inputDurations(
    request: FfmpegRequest,
    paths: LocalPaths,
  ): Promise<Map<string, number>> {
    const names = new Set(
      request.steps
        .filter((step) => step.expectedDurationMs === undefined)
        .flatMap((step) => readInputs(step.args)),
    );
    const durations = new Map<string, number>();
    await Promise.all(
      [...names].map(async (name) => {
        const durationMs = (await this.ffmpeg.probe(paths.input(name)))
          ?.durationMs;
        if (durationMs) durations.set(name, durationMs);
      }),
    );
    return durations;
  }
}

/** The inputs a step's args read. */
function readInputs(args: string[]): string[] {
  return args.flatMap((arg) =>
    parseArg(arg)
      .placeholders.filter((placeholder) => placeholder.kind === 'in')
      .map((placeholder) => placeholder.name),
  );
}

function maxOrUndefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter(
    (value): value is number => value !== undefined,
  );
  return defined.length ? Math.max(...defined) : undefined;
}

/** Quotes an arg for a log line when it has anything a shell would split on. */
function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg)
    ? arg
    : `'${arg.replaceAll("'", `'\\''`)}'`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
