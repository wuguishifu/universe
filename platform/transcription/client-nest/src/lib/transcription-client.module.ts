import { BullModule } from '@nestjs/bullmq';
import { DynamicModule, Module } from '@nestjs/common';
import { QueueConfigMap } from '@libs/queue';
import {
  TRANSCRIPTION_CLIENT_CONFIG,
  TRANSCRIPTION_FLOW_PRODUCER,
} from './constants';
import { TranscriptionClient } from './transcription-client.service';

/**
 * Provides `TranscriptionClient` app-wide, for queueing transcriptions as BullMQ flows.
 *
 * Needs the app's `BullRootModule`: the flow producer reuses its Redis connection (flows only work
 * when every queue in them is on the same Redis) and its prefix for the app's own parent jobs.
 */
@Module({})
export class TranscriptionClientModule {
  public static forRoot<C extends QueueConfigMap>({
    parentQueueConfig,
  }: {
    parentQueueConfig: C;
  }): DynamicModule {
    return {
      module: TranscriptionClientModule,
      global: true,
      imports: [
        BullModule.registerFlowProducer({ name: TRANSCRIPTION_FLOW_PRODUCER }),
      ],
      providers: [
        TranscriptionClient<C>,
        {
          provide: TRANSCRIPTION_CLIENT_CONFIG,
          useValue: parentQueueConfig,
        },
      ],
      exports: [TranscriptionClient<C>, TRANSCRIPTION_CLIENT_CONFIG],
    };
  }
}
