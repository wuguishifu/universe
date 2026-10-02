import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { VoiceBotHeartbeatService } from './voice-bot-heartbeat.service';
import { VoiceCommandWorker } from './voice-command.worker';
import { VoiceSessionService } from './voice-session.service';
import { VoiceSessionStore } from './voice-session.store';

@Module({
  imports: [registerQueue('utterances')],
  providers: [
    VoiceSessionStore,
    VoiceSessionService,
    VoiceBotHeartbeatService,
    VoiceCommandWorker,
  ],
})
export class VoiceModule {}
