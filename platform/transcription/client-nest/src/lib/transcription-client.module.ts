import { DynamicModule, Module } from '@nestjs/common';

import { BullFlowModule } from '@libs/queue';

import { TranscriptionClient } from './transcription-client.service';

/**
 * Provides `TranscriptionClient` app-wide, for queueing transcriptions as BullMQ flows. Also
 * provides `FlowClient`, for flows with several services' jobs.
 *
 * Needs the app's `BullRootModule`: the flow producer reuses its Redis connection (flows only work
 * when every queue in them is on the same Redis) and its prefix for the app's own parent jobs.
 */
@Module({})
export class TranscriptionClientModule {
  public static forRoot(): DynamicModule {
    return {
      module: TranscriptionClientModule,
      global: true,
      imports: [BullFlowModule.forRoot()],
      providers: [TranscriptionClient],
      exports: [TranscriptionClient],
    };
  }
}
