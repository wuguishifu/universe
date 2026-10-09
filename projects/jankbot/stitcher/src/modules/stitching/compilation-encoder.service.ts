import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { runProcess } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';
import { SAMPLE_RATE } from './audio';

const ENCODE_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class CompilationEncoderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CompilationEncoderService.name);
  private readonly abortController = new AbortController();

  constructor(private readonly environmentService: EnvironmentService) {}

  /**
   * ffmpeg is mounted from the host rather than part of the image, so check it's there and can
   * encode Opus before taking jobs, instead of failing the first session that ends.
   */
  async onModuleInit() {
    const { ffmpegPath } = this.environmentService.environment;
    let encoders: string;
    try {
      encoders = await runProcess(ffmpegPath, ['-hide_banner', '-encoders'], {
        timeoutMs: 10_000,
      });
    } catch (error) {
      throw new Error(
        `Can't run ffmpeg at FFMPEG_PATH=${ffmpegPath} (is it mounted?): ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!/\blibopus\b/.test(encoders)) {
      throw new Error(`ffmpeg at ${ffmpegPath} was built without libopus`);
    }
    this.logger.log(`Using ffmpeg at ${ffmpegPath}`);
  }

  onModuleDestroy() {
    this.abortController.abort();
  }

  /** Encodes PCM from audio.ts as Ogg Opus, which Discord and browsers play inline. */
  async encodeOggOpus(pcm: Buffer, workDir: string): Promise<Buffer> {
    const inputPath = path.join(workDir, 'compilation.pcm');
    const outputPath = path.join(workDir, 'compilation.ogg');
    await writeFile(inputPath, pcm);

    // prettier-ignore
    await runProcess(
      this.environmentService.environment.ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', inputPath,
        '-c:a', 'libopus', '-b:a', '32k',
        '-y', outputPath,
      ],
      { timeoutMs: ENCODE_TIMEOUT_MS, signal: this.abortController.signal },
    );
    return readFile(outputPath);
  }
}
