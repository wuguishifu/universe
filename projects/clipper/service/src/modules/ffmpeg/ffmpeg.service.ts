import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { runProcess } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';

const DEFAULT_FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class FFmpegService implements OnModuleInit, OnModuleDestroy {
  private readonly abortController = new AbortController();

  constructor(private readonly environmentService: EnvironmentService) {}

  public async onModuleInit() {
    const { ffmpegPath } = this.environmentService.environment;
    try {
      await runProcess(ffmpegPath, ['-version'], {
        timeoutMs: 10_000,
      });
    } catch (error) {
      throw new Error(
        `Can't run ffmpeg at FFMPEG_PATH=${ffmpegPath} (is it mounted?): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  public onModuleDestroy() {
    this.abortController.abort();
  }

  public async extractAudio({
    inputPath,
    outputPath,
    streamIndex,
    overrideTimeoutMs,
  }: {
    inputPath: string;
    outputPath: string;
    streamIndex?: number;
    overrideTimeoutMs?: number;
  }) {
    // prettier-ignore
    await runProcess(
      this.environmentService.environment.ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error',
        '-nostdin', '-y', '-i', inputPath,
        ...(streamIndex !== undefined ? ['-map', `0:${streamIndex}`] : []),
        '-vn', '-ar', '16000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        outputPath,
      ],
      {
        timeoutMs: overrideTimeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS,
        signal: this.abortController.signal,
      },
    );
  }
}
