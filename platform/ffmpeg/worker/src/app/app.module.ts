import { Module } from '@nestjs/common';

import { S3Module } from '@libs/nest-s3';
import { BullRootModule } from '@libs/queue';
import { FFMPEG_QUEUE_PREFIX } from '@platform/ffmpeg-contracts';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { FfmpegModule } from '../modules/ffmpeg/ffmpeg.module';

@Module({
  imports: [
    EnvironmentModule,
    BullRootModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        redisUrl: env.environment.redisUrl,
        prefix: FFMPEG_QUEUE_PREFIX,
      }),
    }),
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    FfmpegModule,
  ],
})
export class AppModule {}
