import { Inject, Injectable } from '@nestjs/common';

import { BULL_QUEUE_CONFIG, DEFAULT_QUEUE_CONFIG } from '@universe/redis';

import type { EmeraldQueue } from '../../queues/bull-queue.module';

@Injectable()
export class ClipperService {
  constructor(
    @Inject(BULL_QUEUE_CONFIG.trimClip.queueName)
    private readonly trimClipQueue: EmeraldQueue<'trimClip'>,
  ) {}

  public async queueJob({ filePath }: { filePath: string }) {
    await this.trimClipQueue.add(
      BULL_QUEUE_CONFIG.trimClip.jobName,
      { filePath },
      DEFAULT_QUEUE_CONFIG,
    );
  }
}
