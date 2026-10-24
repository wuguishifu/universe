import { Module } from '@nestjs/common';

import { S3Module } from '@libs/nest-s3';
import { TrackingModule } from '@platform/analytics-client-nest';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { AnalysisModule } from '../modules/analysis/analysis.module';
import { ClipsModule } from '../modules/clips/clips.module';
import { CommonModule } from '../modules/common/common.module';
import { RunsModule } from '../modules/runs/runs.module';
import { QueueModule } from '../queues/queue.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    QueueModule,
    TrackingModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        serviceName: 'clipper/service',
        enableBatching: true,
        analyticsServiceBaseUrl:
          environmentService.environment.analyticsServiceBaseUrl,
        analyticsServiceApiKey:
          environmentService.environment.analyticsServiceApiToken,
      }),
    }),
    S3Module.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    CommonModule,
    RunsModule,
    ClipsModule,
    AnalysisModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
