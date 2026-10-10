import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  TranscriptionClient,
  TranscriptionFailedError,
} from '@platform/transcription-client-nest';
import {
  CLIPPER_QUEUE_CONFIG,
  ClipperQueueConfig,
  ClipperQueueJob,
} from '../../../queue/queue';
import { ClipsService } from '../clips.service';

// this processor runs in CPU land
@Processor(CLIPPER_QUEUE_CONFIG.processTranscripts.queueName, {
  concurrency: 1,
})
export class ProcessTranscriptsProcessor extends WorkerHost {
  constructor(
    private readonly clipsService: ClipsService,
    private readonly transcriptionClient: TranscriptionClient<ClipperQueueConfig>,
  ) {
    super();
  }

  override async process(job: ClipperQueueJob<'processTranscripts'>) {
    try {
      const results = await this.transcriptionClient.getResults(job);
      await this.clipsService.processTranscripts({
        jobData: job.data,
        results,
      });
    } catch (error) {
      if (!(error instanceof TranscriptionFailedError)) throw error;
      // TODO: tracking
    }
  }
}
