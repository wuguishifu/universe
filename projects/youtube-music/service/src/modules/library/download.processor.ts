import { WorkerHost } from '@nestjs/bullmq';
import {
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UniverseProcessor } from '@libs/queue';
import { EnvironmentService } from '../../environment/environment';
import { MUSIC_QUEUE_CONFIG, type MusicQueueJob } from '../../queues/queues';
import { FfmpegService } from '../media/ffmpeg.service';
import { isLive, trackMetadata } from '../media/metadata';
import { YtdlpError, YtdlpService } from '../media/ytdlp.service';
import { StorageService } from './storage.service';
import { type TrackRow, TracksService } from './tracks.service';

/** Errors that trying again won't fix. */
class PermanentError extends Error {}

/**
 * Downloads a track: reads the video's info (filling in the title right away), downloads the best
 * audio as m4a, crops the thumbnail into square artwork, measures loudness, and uploads it to S3.
 */
@UniverseProcessor(MUSIC_QUEUE_CONFIG, 'download')
export class DownloadProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DownloadProcessor.name);
  private readonly abortController = new AbortController();

  constructor(
    private readonly tracksService: TracksService,
    private readonly storageService: StorageService,
    private readonly ytdlpService: YtdlpService,
    private readonly ffmpegService: FfmpegService,
    private readonly environmentService: EnvironmentService,
  ) {
    super();
  }

  /** The worker exists by now (it's created on module init), and takes a new concurrency live. */
  onApplicationBootstrap() {
    this.worker.concurrency =
      this.environmentService.environment.downloadConcurrency;
  }

  onModuleDestroy() {
    this.abortController.abort(
      new Error('youtube-music-service is shutting down'),
    );
  }

  override async process(job: MusicQueueJob<'download'>): Promise<void> {
    const track = await this.tracksService.find(job.data.trackId);
    if (!track || track.status === 'ready') return;

    await this.tracksService.markDownloading(track.id);
    const startedAt = Date.now();
    const dir = await mkdtemp(join(tmpdir(), 'youtube-music-'));
    try {
      await this.download(track, dir);
    } catch (error) {
      const permanent =
        error instanceof PermanentError ||
        (error instanceof YtdlpError && !error.retryable);
      const attempts = job.opts.attempts ?? 1;
      // attemptsMade counts the attempts before this one.
      const willRetry = !permanent && job.attemptsMade + 1 < attempts;
      const message = describeError(error);
      this.logger[willRetry ? 'warn' : 'error'](
        `Track ${track.id} (${track.youtubeId}): attempt ${job.attemptsMade + 1}/${attempts} failed: ${message}${willRetry ? ' (will retry)' : ''}`,
      );
      await this.tracksService.markFailed(track.id, message, willRetry);
      if (permanent) throw new UnrecoverableError(message);
      throw error;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    this.logger.log(
      `Track ${track.id} (${track.youtubeId}) ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  }

  private async download(track: TrackRow, dir: string) {
    const signal = this.abortController.signal;
    const infoPath = join(dir, 'info.json');
    const info = await this.ytdlpService.fetchInfo(
      track.youtubeId,
      infoPath,
      signal,
    );
    if (isLive(info)) {
      throw new PermanentError("It's a live stream, which can't be saved");
    }
    const { maxDurationMinutes } = this.environmentService.environment;
    if (info.duration && info.duration > maxDurationMinutes * 60) {
      throw new PermanentError(
        `It's longer than ${maxDurationMinutes} minutes (MAX_DURATION_MINUTES)`,
      );
    }
    await this.tracksService.setMetadata(track.id, trackMetadata(info));

    const { audioPath, thumbnailPath } = await this.ytdlpService.download(
      infoPath,
      dir,
      signal,
    );

    let artworkPath: string | null = null;
    if (thumbnailPath) {
      artworkPath = join(dir, 'square.jpg');
      try {
        await this.ffmpegService.squareArtwork(
          thumbnailPath,
          artworkPath,
          signal,
        );
      } catch (error) {
        this.logger.warn(
          `Track ${track.id}: no artwork, cropping it failed: ${describeError(error)}`,
        );
        artworkPath = null;
      }
    }

    let loudnessLufs: number | null = null;
    try {
      loudnessLufs = await this.ffmpegService.measureLoudness(
        audioPath,
        signal,
      );
    } catch (error) {
      this.logger.warn(
        `Track ${track.id}: couldn't measure loudness: ${describeError(error)}`,
      );
    }

    const audioKey = this.storageService.audioKey(track.youtubeId);
    const audioMimeType = 'audio/mp4';
    const audioSizeBytes = await this.storageService.upload(
      audioKey,
      audioPath,
      audioMimeType,
    );
    const artworkKey = artworkPath
      ? this.storageService.artworkKey(track.youtubeId)
      : null;
    if (artworkKey && artworkPath) {
      await this.storageService.upload(artworkKey, artworkPath, 'image/jpeg');
    }

    const ready = await this.tracksService.markReady(track.id, {
      audioKey,
      audioMimeType,
      audioSizeBytes,
      artworkKey,
      loudnessLufs,
    });
    if (!ready) {
      this.logger.log(`Track ${track.id} was deleted while it downloaded`);
      await this.storageService.delete([audioKey, artworkKey]);
    }
  }
}

/** Network errors (e.g. S3 refusing connections) can be AggregateErrors with no message of their own. */
function describeError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors.map(describeError).join('; ');
  }
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}
