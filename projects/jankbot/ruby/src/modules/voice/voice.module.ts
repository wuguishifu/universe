import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module';
import { VoiceSessionService } from './voice-session.service';
import { VoiceCommands } from './voice.commands';

@Module({
  imports: [TranscriptionModule],
  providers: [VoiceSessionService, VoiceCommands],
})
export class VoiceModule {}
