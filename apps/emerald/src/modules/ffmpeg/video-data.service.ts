import { Injectable, Logger } from '@nestjs/common';

import { spawn } from 'child_process';
import { once } from 'events';

import { Stream, VideoStream } from './stream-types';

@Injectable()
export class VideoDataService {
  private readonly logger = new Logger(VideoDataService.name);

  public async getStreamData({
    videoUrl,
  }: {
    videoUrl: string;
  }): Promise<{ streams: Stream[] }> {
    try {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-analyzeduration',
        '100M',
        '-probesize',
        '100M',
        '-show_streams',
        '-select_streams',
        'v:0',
        videoUrl,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => (output += data.toString()));
      ffprobe.stderr.on('data', (data) =>
        this.logger.debug('ffprobe stderr:', data.toString()),
      );

      await once(ffprobe, 'close');
      if (ffprobe.exitCode !== 0) {
        throw new Error('FFprobe exited with a nonzero exit code');
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return JSON.parse(output) as { streams: Stream[] };
    } catch (error) {
      this.logger.error(`Error getting video data for URL ${videoUrl}:`, error);
      return { streams: [] };
    }
  }

  public getVideoCodec(stream: Stream): string | null {
    if (!stream.codec_name) {
      this.logger.warn(`Could not determine video codec`);
      return null;
    }

    return stream.codec_name;
  }

  public getVideoResolution(
    stream: VideoStream,
  ): { width: number; height: number } | null {
    if (stream.width == null || stream.height == null) {
      this.logger.warn(`Could not determine video resolution`);
      return null;
    }

    return { width: stream.width, height: stream.height };
  }

  public getVideoFrameRate(
    stream: VideoStream,
  ): { rFrameRate: number; averageFrameRate: number } | null {
    if (!stream.r_frame_rate || !stream.avg_frame_rate) {
      this.logger.warn(`Could not determine video frame rate`);
      return null;
    }

    const parseFrameRate = (frameRateStr: string): number => {
      const [numerator = 0, denominator = 1] = frameRateStr
        .split('/')
        .map(Number);
      return denominator ? numerator / denominator : 0;
    };

    return {
      rFrameRate: parseFrameRate(stream.r_frame_rate),
      averageFrameRate: parseFrameRate(stream.avg_frame_rate),
    };
  }

  public getVideoDuration(stream: VideoStream): number | null {
    if (stream.duration == null) {
      this.logger.warn(`Could not determine video duration`);
      return null;
    }

    const durationS = parseFloat(stream.duration);
    if (isNaN(durationS)) {
      this.logger.warn(`Video duration is not a valid number`);
      return null;
    }

    return durationS * 1000;
  }
}
