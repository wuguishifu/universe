import { Module } from '@nestjs/common';
import { S3Module } from '@libs/nest-common';
import { BullRootModule } from '@libs/queue';
import { TranscriptionClientModule } from '@platform/transcription-client-nest';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { ClipsModule } from '../modules/clips/clips.module';
import { UploadsModule } from '../modules/uploads/uploads.module';
import { CLIPPER_QUEUE_CONFIG, CLIPPER_QUEUE_PREFIX } from '../queue/queue';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    BullRootModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        redisUrl: env.environment.redisUrl,
        prefix: CLIPPER_QUEUE_PREFIX,
      }),
    }),
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    TranscriptionClientModule.forRoot({
      parentQueueConfig: CLIPPER_QUEUE_CONFIG,
    }),
    UploadsModule,
    ClipsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
