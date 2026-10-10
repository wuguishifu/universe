import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import z from 'zod';
import { runProcess } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';

const DEFAULT_FFPROBE_TIMEOUT_MS = 15 * 1000;

const ffprobeStreamsOutputSchema = z
  .object({
    streams: z.array(
      z.object({
        index: z.number(),
        tags: z.object({
          name: z.string(),
        }),
      }),
    ),
  })
  .transform((data) =>
    data.streams.map((stream) => ({
      index: stream.index,
      name: stream.tags.name,
    })),
  );

@Injectable()
export class FFprobeService implements OnModuleInit, OnModuleDestroy {
  private readonly abortController = new AbortController();

  constructor(private readonly environmentService: EnvironmentService) {}

  public async onModuleInit() {
    const { ffprobePath } = this.environmentService.environment;
    try {
      await runProcess(ffprobePath, ['-version'], {
        timeoutMs: 10_000,
      });
    } catch (error) {
      throw new Error(
        `Can't run ffprobe at FFPROBE_PATH=${ffprobePath} (is it mounted?): ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  public onModuleDestroy() {
    this.abortController.abort();
  }

  public async identifyTracks({
    inputPath,
    overrideTimeoutMs,
  }: {
    inputPath: string;
    overrideTimeoutMs?: number;
  }) {
    const data = await runProcess(
      this.environmentService.environment.ffprobePath,
      [
        '-v',
        'error',
        '-select_streams',
        'a',
        '-show_entries',
        'stream=index:stream_tags',
        '-of',
        'json',
        inputPath,
      ],
      {
        timeoutMs: overrideTimeoutMs ?? DEFAULT_FFPROBE_TIMEOUT_MS,
        signal: this.abortController.signal,
      },
    );

    return ffprobeStreamsOutputSchema.parse(data);
  }
}
