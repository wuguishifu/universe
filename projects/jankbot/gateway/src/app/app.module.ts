import { Module } from '@nestjs/common';
import { RedisCacheModule } from '@libs/nest-common';
import { TrackingModule } from '@platform/analytics-client-nest';
import { EnvironmentModule, EnvironmentService } from '../config/environment';
import { DiscordModule } from '../modules/discord/discord.module';
import { InteractionsModule } from '../modules/interactions/interactions.module';
import { VoiceModule } from '../modules/voice/voice.module';
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
        serviceName: 'jankbot/gateway',
        enableBatching: true,
        analyticsServiceBaseUrl:
          environmentService.environment.analyticsServiceBaseUrl,
        analyticsServiceApiKey:
          environmentService.environment.analyticsServiceApiToken,
      }),
    }),
    DiscordModule,
    VoiceModule,
    InteractionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
