import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EnvironmentService } from '../../environment/environment';
import { runCommand } from './run-command';

const TIMEOUT_MS = 5 * 60_000;
const ARTWORK_SIZE = 600;

@Injectable()
export class FfmpegService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegService.name);
  private readonly path: string;

  constructor(environmentService: EnvironmentService) {
    this.path = environmentService.environment.ffmpegPath;
  }

  /** ffmpeg is mounted from the host rather than part of the image, so check it's there. */
  async onModuleInit() {
    let filters: string;
    try {
      ({ stdout: filters } = await runCommand(
        this.path,
        ['-hide_banner', '-filters'],
        { timeoutMs: 10_000 },
      ));
    } catch (error) {
      throw new Error(
        `Can't run ffmpeg at FFMPEG_PATH=${this.path} (is it mounted?): ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!/\bebur128\b/.test(filters)) {
      throw new Error(`ffmpeg at ${this.path} was built without ebur128`);
    }
    this.logger.log(`Using ffmpeg at ${this.path}`);
  }

  /**
   * Crops a thumbnail to a centered square. YouTube's are 16:9, and for music the cover is usually
   * in the middle with bars on either side.
   */
  async squareArtwork(input: string, output: string, signal?: AbortSignal) {
    await runCommand(
      this.path,
      [
        '-hide_banner',
        '-y',
        '-i',
        input,
        '-vf',
        `crop='min(iw,ih)':'min(iw,ih)',scale=${ARTWORK_SIZE}:${ARTWORK_SIZE}`,
        '-q:v',
        '3',
        '-frames:v',
        '1',
        output,
      ],
      { timeoutMs: TIMEOUT_MS, signal },
    );
  }

  /** EBU R128 integrated loudness in LUFS, or null if ffmpeg didn't report one (e.g. silence). */
  async measureLoudness(
    input: string,
    signal?: AbortSignal,
  ): Promise<number | null> {
    const { stderr } = await runCommand(
      this.path,
      [
        '-hide_banner',
        '-nostats',
        '-i',
        input,
        '-map',
        '0:a:0',
        '-af',
        'ebur128=framelog=quiet',
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: TIMEOUT_MS, signal },
    );
    // The summary at the end has "I: -14.2 LUFS" under "Integrated loudness".
    const matches = [...stderr.matchAll(/^\s*I:\s+(-?[\d.]+) LUFS/gm)];
    const value = Number(matches.at(-1)?.[1]);
    return Number.isFinite(value) ? value : null;
  }
}
