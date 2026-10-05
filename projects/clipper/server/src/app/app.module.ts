import { Module } from '@nestjs/common';
import { S3Module } from '@libs/nest-common';
import { TranscriptionClientModule } from '@platform/transcription-client-nest';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { UploadsModule } from '../modules/uploads/uploads.module';
import { QueueModule } from '../queue/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    S3Module.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    TranscriptionClientModule.forRootAsync({
      imports: [EnvironmentModule],
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        clientName: 'clipper',
        transcriptionServiceUrl: env.environment.transcriptionServiceUrl,
        transcriptionServiceApiToken:
          env.environment.transcriptionServiceApiToken,
      }),
    }),
    QueueModule,
    UploadsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
