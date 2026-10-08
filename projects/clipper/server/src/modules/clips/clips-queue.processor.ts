import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  TranscriptionClient,
  TranscriptionFailedError,
} from '@platform/transcription-client-nest';
import { CLIPPER_QUEUE_CONFIG, ClipperQueueJob } from '../../queue/queue';
import { ClipsService } from './clips.service';

// this processor runs in CPU land
@Processor(CLIPPER_QUEUE_CONFIG.processTranscript.queueName, { concurrency: 1 })
export class ClipsQueueProcessor extends WorkerHost {
  constructor(
    private readonly clipsService: ClipsService,
    private readonly transcriptionClient: TranscriptionClient,
  ) {
    super();
  }

  override async process(job: ClipperQueueJob<'processTranscript'>) {
    try {
      const result = await this.transcriptionClient.getResult(job);
      await this.clipsService.processTranscript({ ...job.data, ...result });
    } catch (error) {
      if (!(error instanceof TranscriptionFailedError)) throw error;
      // TODO: tracking
    }
  }
}
