import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { VoiceModule } from '../voice/voice.module';
import { InteractionRouter } from './interaction-router';

@Module({
  imports: [registerQueue('interactions'), VoiceModule],
  providers: [InteractionRouter],
})
export class InteractionsModule {}
