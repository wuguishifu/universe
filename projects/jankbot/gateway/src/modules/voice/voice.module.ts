import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSessionStore } from './voice-session.store';
import { VoiceCommands } from './voice.commands';

@Module({
  imports: [registerQueue('utterances')],
  providers: [VoiceSessionStore, VoiceSessionService, VoiceCommands],
  exports: [VoiceCommands],
})
export class VoiceModule {}
