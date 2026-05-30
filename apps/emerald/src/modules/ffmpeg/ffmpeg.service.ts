import { Injectable, Logger } from '@nestjs/common';

import { spawn } from 'child_process';
import { once } from 'events';

import {
  CODECS_THAT_REQUIRE_BA,
  DEFAULT_CA,
  DEFAULT_CRF,
  DEFAULT_PRESET,
  FFmpegFlags,
} from '@universe/contracts-emerald';

const DEFAULT_FFMPEG_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_COARSE_WINDOW_MS = 2000;
const OVERRIDE_FFMPEG_ENCODER = process.env.FFMPEG_ENCODER;
const MAX_H264_NVENC_DIMENSION = 4096;
const NVENC_COMPATIBLE_CODECS = new Set(['h264', 'hevc']);

type FFmpegResult = { success: true } | { success: false; reason: string };
type ENCODER =
  | 'libx264'
  | 'h264_nvenc'
  | 'hevc_nvenc'
  | 'h264_videotoolbox'
  | string;

@Injectable()
export class FFmpegService {
  private readonly logger = new Logger(FFmpegService.name);

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
  }): Promise<FFmpegResult> {
    this.logger.debug(
      `Starting audio extraction for ${inputPath}${streamIndex !== undefined ? ` (stream ${streamIndex})` : ''}`,
    );
    const abortController = new AbortController();

    const ffmpegArgs = [
      '-nostdin',
      '-y',
      '-i',
      inputPath,
      ...(streamIndex !== undefined ? ['-map', `0:${streamIndex}`] : []),
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ];
    this.logger.debug(`Spawning FFmpeg with args: ${ffmpegArgs.join(' ')}`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    const timeoutMs = overrideTimeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS;
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    ffmpeg.stderr.on('data', (data) => this.logger.debug(data.toString()));
    ffmpeg.stdout.on('data', (data) => this.logger.debug(data.toString()));

    await once(ffmpeg, 'close');
    clearTimeout(timeout);
    if (ffmpeg.exitCode !== 0) {
      return {
        success: false,
        reason: `FFmpeg exited with code ${ffmpeg.exitCode}`,
      };
    }

    return { success: true };
  }

  public async splitVideo({
    filePath,
    startTimestamp,
    endTimestamp,
    outputFilePath,
    timeoutMs = DEFAULT_FFMPEG_TIMEOUT_MS,
    ffmpegFlags,
    codec,
    resolution,
    frameRate,
  }: {
    filePath: string;
    startTimestamp: number;
    endTimestamp: number;
    outputFilePath: string;
    timeoutMs?: number;
    ffmpegFlags?: FFmpegFlags;
    codec: string | null;
    resolution: { width: number; height: number } | null;
    frameRate: number | undefined;
  }): Promise<FFmpegResult> {
    this.logger.debug(
      `Starting ffmpeg process to split video from ${startTimestamp} to ${endTimestamp}`,
    );

    const abortController = new AbortController();

    // compute an accurate duration and use a hybrid seek:
    // 1) coarse input-side -ss to jump near the keyframe (fast);
    // 2) accurate output-side -ss/-t to trim precisely.
    const startMs = startTimestamp * 1000;
    const endMs = endTimestamp * 1000;
    if (startMs === null || endMs === null) {
      return {
        success: false,
        reason: 'Invalid timestamp format. Expected HH:MM:SS.mmm',
      };
    }

    const durationMs = endMs - startMs;
    if (durationMs <= 0) {
      return {
        success: false,
        reason: `Invalid split range: end (${endTimestamp}) must be after start (${startTimestamp})`,
      };
    }

    const coarseWindowMs = Number(
      process.env.FFMPEG_COARSE_WINDOW_MS ?? DEFAULT_COARSE_WINDOW_MS,
    );
    const coarseSeekMs = Math.max(0, startMs - Math.max(0, coarseWindowMs));
    const accurateOffsetMs = startMs - coarseSeekMs; // trim from the coarse point
    const durationArg = this.msToHmsMs(durationMs); // FFmpeg accepts HH:MM:SS.mmm

    const encoder = this.resolveEncoderFlagFromCodecAndResolution(
      codec,
      resolution,
    );
    const encoderFlags = ['-c:v', encoder];

    const ffmpegArgs = [
      '-nostdin',
      '-y',
      // coarse fast seek to reduce decode time
      '-ss',
      this.msToHmsMs(coarseSeekMs),
      '-i',
      filePath,
      // accurate trim relative to coarse point
      '-ss',
      this.msToHmsMs(accurateOffsetMs),
      '-t',
      durationArg,
      ...this.resolveStreamMappingFlags(ffmpegFlags),
      ...encoderFlags,
      ...this.resolveFFmpegFlags(encoder, ffmpegFlags),
      ...this.resolveAudioSyncFlags(frameRate ?? 24, ffmpegFlags),
      '-movflags',
      '+faststart',
      outputFilePath,
    ];
    this.logger.debug(`Spawning ffmpeg with args: ${ffmpegArgs.join(' ')}`);
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    ffmpeg.stderr.on('data', (data) =>
      this.logger.debug('ffmpeg stderr:', data.toString()),
    );
    ffmpeg.stdout.on('data', (data) =>
      this.logger.debug('ffmpeg stdout:', data.toString()),
    );

    await once(ffmpeg, 'close');
    clearTimeout(timeout);

    if (ffmpeg.exitCode !== 0) {
      return {
        success: false,
        reason: `FFmpeg exited with code ${ffmpeg.exitCode}`,
      };
    }

    return { success: true };
  }

  /**
   * Determines the optimal encoder to used based on the codec and resolution.
   *
   * If the codec is nvenc compatible, we want to use the specific encoder for that. However,
   * `h264_nvenc` is incompatible with dimensions larger than 4096 so in that condition default to `hevc_nvenc`.
   * We bother with this because h264_nvenc is way faster than hevc_nvenc.
   */
  private resolveEncoderFlagFromCodecAndResolution(
    codec: string | null,
    resolution: { width: number; height: number } | null,
  ): ENCODER {
    if (OVERRIDE_FFMPEG_ENCODER) {
      return OVERRIDE_FFMPEG_ENCODER;
    }

    // this also handles null codec
    if (!NVENC_COMPATIBLE_CODECS.has(codec ?? '')) {
      return 'libx264';
    }

    if (
      // if no resolution is found it's safer to use hevc_nvenc
      !resolution ||
      resolution.width > MAX_H264_NVENC_DIMENSION ||
      resolution.height > MAX_H264_NVENC_DIMENSION
    ) {
      return 'hevc_nvenc';
    }

    return codec === 'h264' ? 'h264_nvenc' : 'hevc_nvenc';
  }

  /**
   * Resolves FFmpeg flags, applying defaults where necessary
   */
  private resolveFFmpegFlags(encoder: ENCODER, flags?: FFmpegFlags) {
    const {
      preset = DEFAULT_PRESET,
      crf = DEFAULT_CRF,
      ca = DEFAULT_CA,
      ba,
    } = flags ?? {};

    // Default arguments for software encoding (libx264/libx265)
    const videoArgs = ['-preset', preset];

    if (encoder === 'h264_nvenc' || encoder === 'hevc_nvenc') {
      const cq = crf + 1; // Your existing logic
      // FIX: NVENC requires specific rate control flags to behave like CRF
      // -rc:v vbr : Use Variable Bitrate control (vbr_hq is deprecated and conflicts with P-presets)
      // -tune hq : Ensure high quality tuning
      // -cq : The target quality (like CRF)
      // -b:v 0 : "0" tells the encoder to let bitrate go as high as needed for the CQ
      videoArgs.push(
        '-rc:v',
        'vbr',
        '-tune',
        'hq',
        '-cq',
        cq.toString(),
        '-b:v',
        '0',
      );

      // Note: 'slow' preset in libx264 maps differently in NVENC.
      // Ideally use '-preset', 'p6' or 'p7' for NVENC, but 'slow' usually maps okay.
    } else {
      // Standard CPU encoding uses -crf
      videoArgs.push('-crf', crf.toString());
    }

    const audioArgs = ['-c:a', ca];
    if (CODECS_THAT_REQUIRE_BA.has(ca)) {
      audioArgs.push('-b:a', ba ?? '192k');
    }

    return [...videoArgs, ...audioArgs];
  }

  /**
   * Resolves stream mapping flags based on provided FFmpeg flags
   * The reason this is a separate function is because if the experiment works, it will be automatically
   * applied via stream data.
   */
  private resolveStreamMappingFlags(flags?: FFmpegFlags) {
    if (flags?.useExperimentalStreamMapping) {
      return ['-map', '0:v', '-map', '0:a?'];
    }

    return [];
  }

  /**
   * Resolves audio sync flags based on provided FFmpeg flags and video framerate
   */
  private resolveAudioSyncFlags(videoFrameRate: number, flags?: FFmpegFlags) {
    if (flags?.useExperimentalAudioSync === 'disabled') {
      return [];
    }

    if (
      flags?.useExperimentalAudioSync === 'enabled' ||
      (flags?.useExperimentalAudioSync === 'auto' && videoFrameRate !== 24)
    ) {
      return [
        '-vsync',
        'cfr',
        '-async',
        '1',
        '-avoid_negative_ts',
        'make_zero',
      ];
    }

    return [];
  }

  /**
   * Parses timestamps like HH:MM:SS.mmm (tolerates comma as decimal separator) into milliseconds
   */
  public parseTimestampToMs(ts: string): number | null {
    if (!ts) {
      return null;
    }
    const safe = ts.trim().replace(',', '.');
    const match = /^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/.exec(safe);
    if (!match) {
      return null;
    }
    const [_, h, m, s, ms] = match;
    const hours = Number(h);
    const minutes = Number(m);
    const seconds = Number(s);
    const millis = Number(ms);
    if ([hours, minutes, seconds, millis].some((n) => Number.isNaN(n))) {
      return null;
    }
    return hours * 3600000 + minutes * 60000 + seconds * 1000 + millis;
  }

  /**
   * Formats milliseconds into HH:MM:SS.mmm
   */
  private msToHmsMs(msTotal: number): string {
    const hours = Math.floor(msTotal / 3600000);
    const remH = msTotal % 3600000;
    const minutes = Math.floor(remH / 60000);
    const remM = remH % 60000;
    const seconds = Math.floor(remM / 1000);
    const millis = remM % 1000;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const mmm = String(millis).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${mmm}`;
  }
}
