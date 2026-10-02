import { DynamicModule, Module, Provider } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import type { Runtime } from '../../runtime';
import { TranscriberService } from './transcriber.service';
import { TranscriptionApiService } from './transcription-api.service';
import { TranscriptionController } from './transcription.controller';
import { LANE_PROCESSORS } from './transcription.processors';
import { WhisperModelsService } from './whisper-models.service';

/**
 * Assembled per role, so one image can run as the API, as a worker for some lanes, or as both.
 * Workers only exist for the lanes listed in TRANSCRIPTION_SERVICE_WORKER_LANES.
 */
@Module({})
export class TranscriptionModule {
  static forRuntime({
    runsApi,
    runsWorker,
    workerLanes,
  }: Runtime): DynamicModule {
    const apiProviders: Provider[] = runsApi ? [TranscriptionApiService] : [];
    const workerProviders: Provider[] = runsWorker
      ? [
          TranscriberService,
          ...workerLanes.map((lane) => LANE_PROCESSORS[lane]),
        ]
      : [];

    return {
      module: TranscriptionModule,
      imports: [registerQueue('interactive'), registerQueue('batch')],
      controllers: runsApi ? [TranscriptionController] : [],
      providers: [WhisperModelsService, ...apiProviders, ...workerProviders],
    };
  }
}
