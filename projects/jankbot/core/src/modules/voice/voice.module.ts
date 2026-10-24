import { Module } from '@nestjs/common';

import { VoiceBotsService } from './voice-bots.service';
import { VoiceCommandClient } from './voice-command.client';
import { JoinCommand, LeaveCommand } from './voice.commands';

@Module({
  providers: [VoiceBotsService, VoiceCommandClient, JoinCommand, LeaveCommand],
  exports: [JoinCommand, LeaveCommand],
})
export class VoiceModule {}
