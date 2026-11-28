import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { S3Service } from '@libs/nest-s3';
import { UniverseProcessor } from '@libs/queue';
import { api } from '@platform/convex-contracts';
import { FfmpegClient, FfmpegFailedError } from '@platform/ffmpeg-client-nest';

import { EnvironmentService } from '../../config/environment';
import {
  DERIVATIVE_KINDS,
  JANKTM_QUEUE_CONFIG,
  type JanktmJob,
} from '../../queues/queue';
import { ConvexService } from '../common/convex.service';
import { withoutUndefined } from '../common/without-undefined';
import { garbageKeys, type InUse } from '../media/ffmpeg-requests';

type Derivative = {
  bucket: string;
  key: string;
  contentType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
};

/** Saves an item's ffmpeg results to Convex, and deletes whatever they replaced. */
@UniverseProcessor(JANKTM_QUEUE_CONFIG, 'complete', { concurrency: 8 })
export class CompleteItemProcessor extends WorkerHost {
  private readonly logger = new Logger(CompleteItemProcessor.name);

  constructor(
    private readonly ffmpeg: FfmpegClient,
    private readonly convex: ConvexService,
    private readonly s3: S3Service,
    private readonly environmentService: EnvironmentService,
  ) {
    super();
  }

  override async process(job: JanktmJob<'complete'>): Promise<void> {
    const { itemId, token, outputs } = job.data;
    let result;
    try {
      result = await this.ffmpeg.getResult(job);
    } catch (error) {
      if (!(error instanceof FfmpegFailedError)) throw error;
      this.logger.warn(`Item ${itemId} failed: ${error.message}`);
      await this.convex.mutation(api.album.processing.failItem, {
        itemId,
        token,
        error: error.message,
      });
      return;
    }

    const derivatives: Partial<
      Record<(typeof DERIVATIVE_KINDS)[number], Derivative>
    > = {};
    for (const kind of DERIVATIVE_KINDS) {
      if (!outputs[kind]) continue;
      const output = result.outputs[kind];
      if (!output)
        throw new Error(`ffmpeg result for item ${itemId} has no ${kind}`);
      const video = output.probe?.streams.find(
        (stream) => stream.type === 'video',
      );
      const moves = kind === 'hover' || kind === 'preview';
      derivatives[kind] = withoutUndefined({
        bucket: output.bucket,
        key: output.key,
        contentType: output.contentType,
        sizeBytes: output.sizeBytes,
        width: video?.width,
        height: video?.height,
        durationMs: moves ? output.probe?.durationMs : undefined,
      });
    }

    // Saving is idempotent, and so is the clean-up after it: a retry (say the delete below failed)
    // gets a fresh picture of what's in use, so it never deletes what this job published.
    const { applied, inUse } = await this.convex.mutation(
      api.album.processing.completeItem,
      { itemId, token, derivatives },
    );
    if (!applied)
      this.logger.debug(`Item ${itemId}'s job ${token} is stale or done`);
    await this.cleanUp(itemId, inUse);
  }

  /**
   * Deletes everything in the item's folder of the derived bucket that it doesn't use: what this
   * job replaced, stale jobs' outputs, and leftovers of failed attempts. Keeps the folder of the
   * job it's waiting on, whose outputs may be uploading.
   */
  private async cleanUp(itemId: string, inUse: InUse): Promise<void> {
    const bucket = this.environmentService.environment.albumDerivedBucket;
    const keys: string[] = [];
    for await (const page of this.s3.listObjects({
      bucket,
      prefix: `${itemId}/`,
    })) {
      keys.push(...page.map((object) => object.key));
    }
    const garbage = garbageKeys(keys, itemId, bucket, inUse);
    if (garbage.length > 0)
      await this.s3.deleteObjects({ bucket, keys: garbage });
  }
}
