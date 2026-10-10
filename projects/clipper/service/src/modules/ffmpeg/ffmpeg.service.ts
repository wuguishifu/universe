import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import path from 'node:path';
import { runProcess } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';
import { FFprobeStream } from './stream-types';

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

  public async extractStreams({
    inputPath,
    outputDir,
    streams,
    overrideTimeoutMs,
  }: {
    inputPath: string;
    outputDir: string;
    streams: FFprobeStream[];
    overrideTimeoutMs?: number;
  }) {
    const maps = streams.map((stream) => [
      '-map',
      `0:${stream.index}`,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      path.join(outputDir, `${stream.type}.wav`),
    ]);

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      inputPath,
      ...maps.flatMap((map) => map),
    ];

    await runProcess(this.environmentService.environment.ffmpegPath, args, {
      timeoutMs: overrideTimeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS,
      signal: this.abortController.signal,
    });

    return streams.map((stream) => ({
      fileName: `${stream.type}.wav`,
      filePath: path.join(outputDir, `${stream.type}.wav`),
    }));
  }
}
