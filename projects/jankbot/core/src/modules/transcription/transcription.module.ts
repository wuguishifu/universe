import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { RecordingsModule } from '../recordings/recordings.module';
import { TrackedWordsModule } from '../tracked-words/tracked-words.module';
import { TranscribedUtteranceProcessor } from './transcribed-utterance.processor';
import { UtteranceProcessor } from './utterance.processor';

@Module({
  imports: [
    registerQueue('utterances'),
    registerQueue('transcribedUtterances'),
    TrackedWordsModule,
    LeaderboardModule,
    RecordingsModule,
  ],
  providers: [UtteranceProcessor, TranscribedUtteranceProcessor],
})
export class TranscriptionModule {}
