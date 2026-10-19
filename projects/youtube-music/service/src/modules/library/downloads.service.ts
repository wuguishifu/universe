import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ServerStatus } from '@projects/youtube-music-contracts';
import {
  downloadJobId,
  MUSIC_QUEUE_CONFIG,
  type MusicQueue,
} from '../../queues/queues';
import { TracksService } from './tracks.service';

/** The download queue, kept in step with the tracks' statuses. */
@Injectable()
export class DownloadsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DownloadsService.name);

  constructor(
    @Inject(MUSIC_QUEUE_CONFIG.download.queueName)
    private readonly queue: MusicQueue<'download'>,
    private readonly tracksService: TracksService,
  ) {}

  /**
   * Queues anything that should be downloading but has no job, e.g. after Redis lost its data.
   * Tracks that already have one keep it.
   */
  async onApplicationBootstrap() {
    const tracks = await this.tracksService.unfinished();
    for (const track of tracks) await this.enqueue(track.id);
    if (tracks.length) {
      this.logger.log(`${tracks.length} track(s) waiting to download`);
    }
  }

  /** Queues a track's download, unless it's already waiting or running. */
  async enqueue(trackId: number) {
    const jobId = downloadJobId(trackId);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      // A finished job keeps its ID until it's cleaned up, which would make adding this one a no-op.
      if (state !== 'completed' && state !== 'failed') return;
      await existing.remove();
    }
    await this.queue.add(
      MUSIC_QUEUE_CONFIG.download.jobName,
      { trackId },
      { jobId },
    );
  }

  /** Drops a track's job if it hasn't started. One that has finds the track gone and cleans up. */
  async cancel(trackId: number) {
    const job = await this.queue.getJob(downloadJobId(trackId));
    if (job && !(await job.isActive())) await job.remove();
  }

  async counts(): Promise<ServerStatus['queue']> {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'prioritized',
      'delayed',
      'active',
      'failed',
    );
    return {
      waiting:
        (counts.waiting ?? 0) +
        (counts.prioritized ?? 0) +
        (counts.delayed ?? 0),
      active: counts.active ?? 0,
      failed: counts.failed ?? 0,
    };
  }
}
