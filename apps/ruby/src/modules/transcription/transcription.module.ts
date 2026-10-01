import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { FeedModule } from '../feed/feed.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { TrackedWordsModule } from '../tracked-words/tracked-words.module';
import { UtteranceProcessor } from './utterance.processor';

@Module({
  imports: [
    registerQueue('utterances'),
    FeedModule,
    TrackedWordsModule,
    LeaderboardModule,
  ],
  providers: [UtteranceProcessor],
})
export class TranscriptionModule {}
