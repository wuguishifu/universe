import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
import { DiscordModule } from '../modules/discord/discord.module';
import { InteractionsModule } from '../modules/interactions/interactions.module';
import { RedisModule } from '../modules/redis/redis.module';
import { VoiceModule } from '../modules/voice/voice.module';
import { QueueModule } from '../queues/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    EnvironmentModule,
    QueueModule,
    RedisModule,
    DiscordModule,
    VoiceModule,
    InteractionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
