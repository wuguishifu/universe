import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { S3Module, UniverseDbModule } from '@libs/nest-common';
import { ApiTokenGuard } from '../auth/api-token.guard';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
import { LibraryModule } from '../modules/library/library.module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    QueueModule,
    UniverseDbModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => ({
        connectionString: env.environment.universeDbConnectionString,
      }),
    }),
    S3Module.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (env: EnvironmentService) => env.environment.s3,
    }),
    LibraryModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ApiTokenGuard }],
})
export class AppModule {}
