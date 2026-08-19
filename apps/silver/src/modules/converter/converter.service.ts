import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_QUEUE_CONFIG,
  SILVER_QUEUE_CONFIG,
  type SilverQueue,
} from '@universe/queue';

@Injectable()
export class ConverterService {
  constructor(
    @Inject(SILVER_QUEUE_CONFIG.youtubeConverter.queueName)
    private readonly youtubeConverterQueue: SilverQueue<'youtubeConverter'>,
  ) {}

  public async queueConversionJob(url: string) {
    await this.youtubeConverterQueue.add(
      SILVER_QUEUE_CONFIG.youtubeConverter.jobName,
      { url },
      DEFAULT_QUEUE_CONFIG,
    );
  }
}
