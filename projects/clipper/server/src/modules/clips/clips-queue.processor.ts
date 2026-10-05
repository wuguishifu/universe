import { Processor, WorkerHost } from '@nestjs/bullmq';
import { CLIPPER_QUEUE_CONFIG, ClipperQueueJob } from '../../queue/queue';

// this processor runs in CPU land
@Processor(CLIPPER_QUEUE_CONFIG.processClip.queueName, { concurrency: 1 })
export class ClipsQueueProcessor extends WorkerHost {
  constructor() {
    super();
  }

  override async process(job: ClipperQueueJob<'processClip'>) {
    const { key } = job.data;
  }
}
