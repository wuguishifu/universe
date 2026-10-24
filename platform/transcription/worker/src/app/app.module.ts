import { Module } from '@nestjs/common';

import { S3Module } from '@libs/nest-common';
import { BullRootModule } from '@libs/queue';
import { TRANSCRIPTION_QUEUE_PREFIX } from '@platform/transcription-contracts';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { TranscriptionModule } from '../modules/transcription/transcription.module';

@Module({
  imports: [
    EnvironmentModule,
    BullRootModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        redisUrl: env.environment.redisUrl,
        prefix: TRANSCRIPTION_QUEUE_PREFIX,
      }),
    }),
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    TranscriptionModule,
  ],
})
export class AppModule {}
