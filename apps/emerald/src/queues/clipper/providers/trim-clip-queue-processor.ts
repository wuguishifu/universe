import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { BULL_QUEUE_CONFIG, QueueJob } from '@universe/redis';

@Processor(BULL_QUEUE_CONFIG.trimClip.queueName)
export class TrimClipQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TrimClipQueueProcessor.name);

  override async process(job: QueueJob<'trimClip'>) {
    const { filePath } = job.data;
    this.logger.log(`processing ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    this.logger.log('done');
  }
}
