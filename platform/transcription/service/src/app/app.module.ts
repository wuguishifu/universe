import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { S3Module } from '@libs/nest-common';
import { ApiTokenGuard } from '../auth/api-token.guard';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { TranscriptionModule } from '../modules/transcription/transcription.module';
import { QueueModule } from '../queues/queue.module';
import { readRuntime } from '../runtime';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    QueueModule,
    TranscriptionModule.forRuntime(readRuntime()),
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule {}
