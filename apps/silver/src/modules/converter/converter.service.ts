import { Inject, Injectable } from '@nestjs/common';
import { api } from '@universe/hydrogen-kore';
import {
  DEFAULT_QUEUE_CONFIG,
  SILVER_QUEUE_CONFIG,
  type SilverQueue,
} from '@universe/queue';
import { ConvexClientService } from '../common/convex-client.service';
import { S3Service } from '../s3/s3.service';
import { s3Key } from './youtube-id';

@Injectable()
export class ConverterService {
  constructor(
    @Inject(SILVER_QUEUE_CONFIG.youtubeConverter.queueName)
    private readonly youtubeConverterQueue: SilverQueue<'youtubeConverter'>,
    private readonly convexClientService: ConvexClientService,
    private readonly s3Service: S3Service,
  ) {}

  public async queueConversionJob(videoId: string) {
    const key = s3Key(videoId);

    await this.convexClientService.client.mutation(
      api.silver.converter.audioConversions.upsertRecord,
      { youtubeId: videoId, s3Key: key },
    );

    if (await this.s3Service.exists(key)) {
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
