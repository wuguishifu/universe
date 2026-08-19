import { Inject, Injectable, Logger } from '@nestjs/common';
import { api } from '@universe/hydrogen-kore';
import {
  DEFAULT_QUEUE_CONFIG,
  SILVER_QUEUE_CONFIG,
  type SilverQueue,
} from '@universe/queue';
import { ConvexClientService } from '../common/convex-client.service';
import { extractYoutubeId, s3Key } from './youtube-id';

@Injectable()
export class ConverterService {
  private readonly logger = new Logger(ConverterService.name);

  constructor(
    @Inject(SILVER_QUEUE_CONFIG.youtubeConverter.queueName)
    private readonly youtubeConverterQueue: SilverQueue<'youtubeConverter'>,
    private readonly convexClientService: ConvexClientService,
  ) {}

  public async queueConversionJob(url: string) {
    const youtubeId = extractYoutubeId(url, this.logger.error);
    if (!youtubeId) throw new Error('invalid url');

    await this.youtubeConverterQueue.add(
      SILVER_QUEUE_CONFIG.youtubeConverter.jobName,
      { url },
      DEFAULT_QUEUE_CONFIG,
    );

    await this.convexClientService.client.mutation(
      api.silver.converter.audioConversions.upsertRecord,
      { youtubeId, s3Key: s3Key(youtubeId) },
    );
  }
}
