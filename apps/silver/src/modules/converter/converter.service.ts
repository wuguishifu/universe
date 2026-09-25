import { Inject, Injectable } from '@nestjs/common';
import { api } from '@universe/hydrogen-kore';
import { S3Service } from '@universe/nest-common';
import { DEFAULT_QUEUE_CONFIG } from '@universe/queue';
import { EnvironmentService } from '../../environment/environment-service';
import { SILVER_QUEUE_CONFIG, type SilverQueue } from '../../queues/queue';
import { ConvexClientService } from '../common/convex-client.service';
import { s3Key } from './youtube-id';

@Injectable()
export class ConverterService {
  constructor(
    @Inject(SILVER_QUEUE_CONFIG.youtubeConverter.queueName)
    private readonly youtubeConverterQueue: SilverQueue<'youtubeConverter'>,
    private readonly convexClientService: ConvexClientService,
    private readonly s3Service: S3Service,
    private readonly environmentService: EnvironmentService,
  ) {}

  public async queueConversionJob(videoId: string) {
    const key = s3Key(videoId);

    await this.convexClientService.client.mutation(
      api.silver.converter.audioConversions.upsertRecord,
      { youtubeId: videoId, s3Key: key },
    );

    if (
      await this.s3Service.exists({
        key,
        bucket: this.environmentService.environment.s3Bucket,
      })
    ) {
      await this.convexClientService.client.mutation(
        api.silver.converter.audioConversions.updateStatus,
        { youtubeId: videoId, status: 'completed' },
      );
      return;
    }

    await this.youtubeConverterQueue.add(
      SILVER_QUEUE_CONFIG.youtubeConverter.jobName,
      { videoId },
      DEFAULT_QUEUE_CONFIG,
    );
  }
}
