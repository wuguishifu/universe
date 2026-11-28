import { Injectable, Logger } from '@nestjs/common';

import { FlowClient } from '@libs/queue';
import { api } from '@platform/convex-contracts';
import { FfmpegClient } from '@platform/ffmpeg-client-nest';

import { EnvironmentService } from '../../config/environment';
import { JANKTM_JOB_OPTIONS, JANKTM_QUEUE_CONFIG } from '../../queues/queue';
import type { JobInput } from '../common/album-types';
import { ConvexService } from '../common/convex.service';
import { mediaFormat } from '../media/album-objects';
import { buildItemRequest } from '../media/ffmpeg-requests';

/** Flows added per round trip to Redis. */
const FLOW_CHUNK = 200;

/** Queues items' processing: an ffmpeg job on the mini, then a `complete` job here. */
@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);

  constructor(
    private readonly flows: FlowClient,
    private readonly ffmpeg: FfmpegClient,
    private readonly convex: ConvexService,
    private readonly environmentService: EnvironmentService,
  ) {}

  /**
   * Queues each job's flow. A job already queued (by its token) is a no-op. Returns how many were
   * queued; jobs whose request can't be built are failed in Convex instead.
   */
  public async enqueue(jobs: JobInput[]): Promise<number> {
    const { albumDerivedBucket } = this.environmentService.environment;
    const flows = [];
    for (const job of jobs) {
      try {
        const format = mediaFormat(job.original.key);
        if (!format) throw new Error(`Not a media file: ${job.original.key}`);
        const { request, outputs, priority } = buildItemRequest(
          { ...job, format },
          albumDerivedBucket,
        );
        flows.push({
          idempotencyKey: job.token,
          parent: {
            queueConfig: JANKTM_QUEUE_CONFIG,
            queueKey: 'complete' as const,
            data: { itemId: job.itemId, token: job.token, outputs },
            opts: JANKTM_JOB_OPTIONS.complete,
          },
          children: [
            // The parent runs either way, so it can record a failure in Convex.
            this.ffmpeg.child(request, { priority, onFailure: 'run-parent' }),
          ],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Can't queue item ${job.itemId}: ${message}`);
        await this.convex.mutation(api.album.processing.failItem, {
          itemId: job.itemId,
          token: job.token,
          error: message,
        });
      }
    }
    for (let i = 0; i < flows.length; i += FLOW_CHUNK) {
      await this.flows.addFlows(flows.slice(i, i + FLOW_CHUNK));
    }
    return flows.length;
  }
}
