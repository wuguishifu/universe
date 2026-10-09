import { Module } from '@nestjs/common';
import { S3Module, UniverseDbModule } from '@libs/nest-common';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { StitchingModule } from '../modules/stitching/stitching.module';
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
