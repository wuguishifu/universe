import { Inject, Injectable } from '@nestjs/common';

import { OsmiumService } from '@universe/nest-common';
import {
  BULL_QUEUE_CONFIG,
  DEFAULT_QUEUE_CONFIG,
  JobData,
} from '@universe/redis';

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

  public async queueJob(job: JobData<'trimClip'>) {
    this.osmiumService.trackEvent({
      name: 'clipper_service-job_queued',
      metadata: job,
    });
    await this.trimClipQueue.add(
      BULL_QUEUE_CONFIG.trimClip.jobName,
      job,
      DEFAULT_QUEUE_CONFIG,
    );
  }

  public async queueBatch(jobs: JobData<'trimClip'>[]) {
    this.osmiumService.trackEvent({
      name: 'clipper_service-batch_queued',
      metadata: {
        count: jobs.length,
        jobs,
      },
    });
    await this.trimClipQueue.addBulk(
      jobs.map((job) => ({
        name: BULL_QUEUE_CONFIG.trimClip.jobName,
        data: job,
        opts: DEFAULT_QUEUE_CONFIG,
      })),
    );
  }
}
