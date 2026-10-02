import { Module } from '@nestjs/common';
import { RedisCacheModule } from '@libs/nest-common';
import { EnvironmentModule } from '../environment/environment-module';
import { EnvironmentService } from '../environment/environment-service';
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
    DiscordModule,
    VoiceModule,
    InteractionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
