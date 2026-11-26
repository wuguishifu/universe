import { DynamicModule, Module } from '@nestjs/common';

import { BullFlowModule } from '@libs/queue';

import { FfmpegClient } from './ffmpeg-client.service';

/**
 * Provides `FfmpegClient` app-wide, for queueing ffmpeg jobs as BullMQ flows. Also provides
 * `FlowClient`, for flows with several services' jobs.
 *
 * Needs the app's `BullRootModule`: the flow producer reuses its Redis connection (flows only work
 * when every queue in them is on the same Redis) and its prefix for the app's own parent jobs.
 */
@Module({})
export class FfmpegClientModule {
  public static forRoot(): DynamicModule {
    return {
      module: FfmpegClientModule,
      global: true,
      imports: [BullFlowModule.forRoot()],
      providers: [FfmpegClient],
      exports: [FfmpegClient],
    };
  }
}
