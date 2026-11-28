import { Module } from '@nestjs/common';

import { S3Module } from '@libs/nest-s3';
import { FfmpegClientModule } from '@platform/ffmpeg-client-nest';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { CommonModule } from '../modules/common/common.module';
import { ProcessingModule } from '../modules/processing/processing.module';
import { ScanModule } from '../modules/scan/scan.module';
import { QueueModule } from '../queues/queue.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    QueueModule,
    S3Module.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    // Reuses QueueModule's Redis connection: the ffmpeg flows' queues must share a Redis.
    FfmpegClientModule.forRoot(),
    CommonModule,
    ProcessingModule,
    ScanModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
