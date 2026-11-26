import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { spawn } from 'child_process';

import { runProcess } from '@libs/nest-core';
import type { FfmpegProbe } from '@platform/ffmpeg-contracts';

import { EnvironmentService } from '../../config/environment';

import { FfmpegExitError, FfmpegTimeoutError, tail } from './errors';
import { toProbe } from './probe';
import { createProgressParser } from './progress';

/** Plenty for the tail of stderr kept in errors. */
const MAX_STDERR_CHARS = 16_000;
const PROBE_TIMEOUT_MS = 30_000;

/** Always first, before the job's own args. `-progress` is read for the job's progress. */
const FIXED_ARGS = [
  '-hide_banner',
  '-nostdin',
  '-y',
  '-nostats',
  '-progress',
  'pipe:1',
];

@Injectable()
export class FfmpegService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FfmpegService.name);
  /** Kills running ffmpegs on shutdown; their jobs fail and are retried. */
  private readonly abortController = new AbortController();

  constructor(private readonly environmentService: EnvironmentService) {}

  async onModuleInit() {
    const { ffmpegPath, ffprobePath, ffmpegRequiredEncoders } =
      this.environmentService.environment;
    let encoders: string;
    try {
      encoders = await runProcess(ffmpegPath, ['-hide_banner', '-encoders'], {
        timeoutMs: 10_000,
      });
      await runProcess(ffprobePath, ['-version'], { timeoutMs: 10_000 });
    } catch (error) {
      throw new Error(
        `Can't run ffmpeg (FFMPEG_PATH=${ffmpegPath}) or ffprobe (FFPROBE_PATH=${ffprobePath}): ${error instanceof Error ? error.message : error}`,
      );
    }
    for (const encoder of ffmpegRequiredEncoders) {
      if (!new RegExp(`\\b${encoder}\\b`).test(encoders)) {
        throw new Error(
          `ffmpeg at ${ffmpegPath} has no ${encoder} encoder (FFMPEG_REQUIRED_ENCODERS)`,
        );
      }
    }
    this.logger.log(
      `Using ffmpeg at ${ffmpegPath}${ffmpegRequiredEncoders.length ? ` with ${ffmpegRequiredEncoders.join(', ')}` : ''}`,
    );
  }

  onModuleDestroy() {
    this.abortController.abort(new Error('ffmpeg-worker is shutting down'));
  }

  /**
   * Runs ffmpeg in `cwd` with `args` (after `FIXED_ARGS`).
   *
   * @throws FfmpegExitError if it fails, FfmpegTimeoutError if it's killed after `timeoutMs`, or
   * the abort reason on shutdown.
   */
  public run({
    args,
    cwd,
    timeoutMs,
    onOutTime,
  }: {
    args: string[];
    cwd: string;
    timeoutMs: number;
    /** How far into the output ffmpeg is, in ms, about twice a second. */
    onOutTime?: (outTimeMs: number) => void;
  }): Promise<void> {
    const signal = this.abortController.signal;
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      const child = spawn(
        this.environmentService.environment.ffmpegPath,
        [...FIXED_ARGS, ...args],
        { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      let timedOut = false;

      const parseProgress = createProgressParser((ms) => onOutTime?.(ms));
      child.stdout.setEncoding('utf8').on('data', parseProgress);
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      const onAbort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };

      child.once('error', (error) => {
        cleanup();
        reject(new Error(`Failed to start ffmpeg: ${error.message}`));
      });
      child.once('close', (code, killSignal) => {
        cleanup();
        if (signal.aborted) {
          reject(signal.reason);
        } else if (timedOut) {
          reject(new FfmpegTimeoutError(timeoutMs, tail(stderr)));
        } else if (code !== 0) {
          reject(new FfmpegExitError(code, killSignal, tail(stderr)));
        } else {
          resolve();
        }
      });
    });
  }

  /** What's in a media file, or undefined if ffprobe can't read it (e.g. a text file). */
  public async probe(file: string): Promise<FfmpegProbe | undefined> {
    try {
      const output = await runProcess(
        this.environmentService.environment.ffprobePath,
        [
          '-v',
          'error',
          '-print_format',
          'json',
          '-show_format',
          '-show_streams',
          file,
        ],
        { timeoutMs: PROBE_TIMEOUT_MS, signal: this.abortController.signal },
      );
      return toProbe(output);
    } catch (error) {
      this.logger.debug(
        `Can't probe ${file}: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }
}
