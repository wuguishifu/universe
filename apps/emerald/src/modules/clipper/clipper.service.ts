import { Inject, Injectable } from '@nestjs/common';

import { OsmiumService } from '@universe/nest-common';
import { BULL_QUEUE_CONFIG, DEFAULT_QUEUE_CONFIG } from '@universe/redis';

import { OSMIUM_SERVICE } from '../../constants';
import type { EmeraldQueue } from '../../queues/bull-queue.module';

@Injectable()
export class ClipperService {
  constructor(
    @Inject(BULL_QUEUE_CONFIG.trimClip.queueName)
    private readonly trimClipQueue: EmeraldQueue<'trimClip'>,
    @Inject(OSMIUM_SERVICE)
    private readonly osmiumService: OsmiumService,
  ) {}

  public async queueJob({ filePath }: { filePath: string }) {
    this.osmiumService.trackEvent({
      name: 'clipper_service-job_queued',
      metadata: { filePath },
    });
    await this.trimClipQueue.add(
      BULL_QUEUE_CONFIG.trimClip.jobName,
      { filePath },
      DEFAULT_QUEUE_CONFIG,
    );
  }
}
