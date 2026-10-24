import { Module } from '@nestjs/common';
import { S3Module, UniverseDbModule } from '@libs/nest-common';
import { TrackingModule } from '@platform/analytics-client-nest';
import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { StitchingModule } from '../modules/stitching/stitching.module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    QueueModule,
    TrackingModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        serviceName: 'jankbot/stitcher',
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
    UniverseDbModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        connectionString: env.environment.universeDbConnectionString,
      }),
    }),
    StitchingModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
