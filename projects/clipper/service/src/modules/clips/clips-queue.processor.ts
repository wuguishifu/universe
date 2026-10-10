import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  TranscriptionClient,
  TranscriptionFailedError,
} from '@platform/transcription-client-nest';
import {
  CLIPPER_QUEUE_CONFIG,
  ClipperQueueConfig,
  ClipperQueueJob,
} from '../../queue/queue';
import { CLIP_TRANSCRIPTION_KEY, ClipsService } from './clips.service';

// this processor runs in CPU land
@Processor(CLIPPER_QUEUE_CONFIG.processTranscript.queueName, { concurrency: 1 })
export class ClipsQueueProcessor extends WorkerHost {
  constructor(
    private readonly clipsService: ClipsService,
    private readonly transcriptionClient: TranscriptionClient<ClipperQueueConfig>,
  ) {
    super();
  }

  override async process(job: ClipperQueueJob<'processTranscript'>) {
    try {
      const result = await this.transcriptionClient.getResult(
        job,
        CLIP_TRANSCRIPTION_KEY,
      );
      await this.clipsService.processTranscript({ jobData: job.data, result });
    } catch (error) {
      if (!(error instanceof TranscriptionFailedError)) throw error;
      // TODO: tracking
    }
  }
}
