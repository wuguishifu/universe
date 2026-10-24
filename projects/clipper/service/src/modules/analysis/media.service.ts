import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import path from 'path';
import { runProcess } from '@libs/nest-common';
import { PROXY } from '@projects/clipper-contracts';
import { EnvironmentService } from '../../config/environment';

/** Proxies are a few MB and at most a few minutes; this only catches a stuck ffmpeg. */
const FFMPEG_TIMEOUT_MS = 60_000;

export type PreparedMedia = {
  path: string;
  mimeType: string;
  durationSec: number;
  /** Where the media starts in the clip: add it to the model's timestamps. */
  offsetSec: number;
};

/** Cuts a clip's proxy down to what a run sends Gemini. */
@Injectable()
export class MediaService implements OnModuleInit {
  private readonly logger = new Logger(MediaService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  /**
   * ffmpeg is mounted from the host rather than part of the image, so check it's there and has
   * what's needed before taking jobs, instead of failing every audio-only clip.
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
    for (const encoder of ['libx264', 'aac']) {
      if (!new RegExp(`\\b${encoder}\\b`).test(encoders)) {
        throw new Error(`ffmpeg at ${ffmpegPath} was built without ${encoder}`);
      }
    }
    this.logger.log(`Using ffmpeg at ${ffmpegPath}`);
  }

  /**
   * The whole proxy is sent as is. For `tailSeconds` it's cut to its last that-many seconds,
   * re-encoded so the cut lands exactly (the proxy is small, so that's quick), and starting at 0 so
   * the model's timestamps are simply offset. For audio, the soundtrack is taken out.
   */
  async prepare({
    proxyPath,
    workDir,
    media,
    clipDurationSec,
    tailSeconds,
    signal,
  }: {
    proxyPath: string;
    workDir: string;
    media: 'video' | 'audio';
    clipDurationSec: number;
    tailSeconds?: number;
    signal: AbortSignal;
  }): Promise<PreparedMedia> {
    const offsetSec =
      tailSeconds && tailSeconds < clipDurationSec
        ? clipDurationSec - tailSeconds
        : 0;
    const durationSec = clipDurationSec - offsetSec;
    const seek = offsetSec > 0 ? ['-ss', offsetSec.toFixed(3)] : [];

    if (media === 'video' && offsetSec === 0) {
      return {
        path: proxyPath,
        mimeType: PROXY.contentType,
        durationSec,
        offsetSec,
      };
    }

    const output =
      media === 'audio'
        ? { path: path.join(workDir, 'audio.aac'), mimeType: 'audio/aac' }
        : { path: path.join(workDir, 'tail.mp4'), mimeType: PROXY.contentType };
    // Copying the audio after a seek would start up to a second early, so a cut tail is re-encoded.
    // prettier-ignore
    const args = media === 'audio'
      ? [
          ...seek, '-i', proxyPath, '-vn',
          ...(offsetSec > 0 ? ['-c:a', 'aac', '-b:a', '64k'] : ['-c:a', 'copy']),
          '-f', 'adts', output.path,
        ]
      : [
          ...seek, '-i', proxyPath,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', String(PROXY.fps * 2),
          '-c:a', 'aac', '-b:a', '64k',
          '-movflags', '+faststart', output.path,
        ];
    await runProcess(
      this.environmentService.environment.ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args],
      { timeoutMs: FFMPEG_TIMEOUT_MS, signal },
    );
    return { ...output, durationSec, offsetSec };
  }
}
