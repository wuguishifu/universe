import { Module } from '@nestjs/common';
import { EnvironmentModule } from '../environment/environment-module';
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
