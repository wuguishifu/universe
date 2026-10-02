import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Transcript } from '@universe/platform/transcription/contracts';
import {
  TRANSCRIPTION_SERVICE_QUEUE_CONFIG,
  type TranscriptionJob,
  type TranscriptionLane,
} from '../../queues/queue';
import { TranscriberService } from './transcriber.service';

// One processor class per lane because @Processor binds a class to a single queue.
// Concurrency 1: whisper already uses every thread it's given, so parallel jobs just contend.

@Processor(TRANSCRIPTION_SERVICE_QUEUE_CONFIG.interactive.queueName, {
  concurrency: 1,
})
export class InteractiveTranscriptionProcessor extends WorkerHost {
  constructor(private readonly transcriber: TranscriberService) {
    super();
  }

  override process(job: TranscriptionJob): Promise<Transcript> {
    return this.transcriber.transcribe(job.data, 'interactive');
  }
}

@Processor(TRANSCRIPTION_SERVICE_QUEUE_CONFIG.batch.queueName, {
  concurrency: 1,
})
export class BatchTranscriptionProcessor extends WorkerHost {
  constructor(private readonly transcriber: TranscriberService) {
    super();
  }

  override process(job: TranscriptionJob): Promise<Transcript> {
    return this.transcriber.transcribe(job.data, 'batch');
  }
}

export const LANE_PROCESSORS = {
  interactive: InteractiveTranscriptionProcessor,
  batch: BatchTranscriptionProcessor,
} satisfies Record<TranscriptionLane, unknown>;
