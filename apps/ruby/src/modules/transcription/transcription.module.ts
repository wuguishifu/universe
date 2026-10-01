import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { TrackedWordsModule } from '../tracked-words/tracked-words.module';
import { UtteranceProcessor } from './utterance.processor';

@Module({
  imports: [registerQueue('utterances'), TrackedWordsModule, LeaderboardModule],
  providers: [UtteranceProcessor],
})
export class TranscriptionModule {}
