import { Module } from '@nestjs/common';

import {
  RedisCacheModule,
  S3Module,
  UniverseDbModule,
} from '@libs/nest-common';
import { TrackingModule } from '@platform/analytics-client-nest';
import { TranscriptionClientModule } from '@platform/transcription-client-nest';

import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { CommonModule } from '../modules/common/common.module';
import { DiscordModule } from '../modules/discord/discord.module';
import { InteractionsModule } from '../modules/interactions/interactions.module';
import { LeaderboardModule } from '../modules/leaderboard/leaderboard.module';
import { TrackedWordsModule } from '../modules/tracked-words/tracked-words.module';
import { TranscriptionModule } from '../modules/transcription/transcription.module';
import { QueueModule } from '../queues/queue.module';

import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    QueueModule,
    RedisCacheModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        url: environmentService.environment.redisUrl,
      }),
    }),
    TrackingModule.forRootAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        serviceName: 'jankbot/core',
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
    // Reuses QueueModule's Redis connection: the transcription flows' queues must share a Redis.
    TranscriptionClientModule.forRoot(),
    CommonModule,
    DiscordModule,
    TrackedWordsModule,
    LeaderboardModule,
    TranscriptionModule,
    InteractionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
