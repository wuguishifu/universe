import { Module } from '@nestjs/common';

import { registerQueue } from '../../queues/queue';
import { CompilationOptOutsModule } from '../compilation-opt-outs/compilation-opt-outs.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { TrackedWordsModule } from '../tracked-words/tracked-words.module';
import { VoiceModule } from '../voice/voice.module';

import { CommandRegistrationService } from './command-registration.service';
import { CommandRegistry } from './command-registry';
import { InteractionProcessor } from './interaction.processor';

@Module({
  imports: [
    registerQueue('interactions'),
    TrackedWordsModule,
    LeaderboardModule,
    VoiceModule,
    CompilationOptOutsModule,
  ],
  providers: [
    CommandRegistry,
    CommandRegistrationService,
    InteractionProcessor,
  ],
})
export class InteractionsModule {}
