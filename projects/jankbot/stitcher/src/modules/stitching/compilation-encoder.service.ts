import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { stat } from 'fs/promises';
import { runProcess } from '@libs/nest-common';
import { UTTERANCE_WAV } from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../config/environment';
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

  /**
   * Encodes a file of raw PCM from audio.ts as Ogg Opus, which Discord and browsers play inline,
   * next to it. Returns the new file's path. Both stay on disk, however long the compilation.
   */
  async encodeOggOpus(pcmPath: string): Promise<string> {
    const outputPath = pcmPath.replace(/\.pcm$/, '') + '.ogg';
    const { size } = await stat(pcmPath);
    const durationMs =
      (size / UTTERANCE_WAV.bytesPerSample / SAMPLE_RATE) * 1000;

    // prettier-ignore
    await runProcess(
      this.environmentService.environment.ffmpegPath,
      [
        '-hide_banner', '-loglevel', 'error',
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', pcmPath,
        '-c:a', 'libopus', '-b:a', '32k',
        '-y', outputPath,
      ],
      {
        // libopus runs far faster than real time; this only catches a stuck ffmpeg.
        timeoutMs: Math.max(ENCODE_TIMEOUT_MS, durationMs / 4),
        signal: this.abortController.signal,
      },
    );
    return outputPath;
  }
}
