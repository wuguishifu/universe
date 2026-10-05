import { Module } from '@nestjs/common';
import { RedisCacheModule } from '@libs/nest-common';
import { TrackingModule } from '@platform/analytics-client-nest';
import {
  EnvironmentModule,
  EnvironmentService,
} from '../environment/environment';
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
