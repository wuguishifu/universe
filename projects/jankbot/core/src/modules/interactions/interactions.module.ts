import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { TrackedWordsModule } from '../tracked-words/tracked-words.module';
import { CommandRegistrationService } from './command-registration.service';
import { CommandRegistry } from './command-registry';
import { InteractionProcessor } from './interaction.processor';

@Module({
  imports: [
    registerQueue('interactions'),
    TrackedWordsModule,
    LeaderboardModule,
  ],
  providers: [
    CommandRegistry,
    CommandRegistrationService,
    InteractionProcessor,
  ],
})
export class InteractionsModule {}
