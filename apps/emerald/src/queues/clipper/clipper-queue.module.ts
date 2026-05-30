import { Module } from '@nestjs/common';
import { ClaudeModule } from '../../app/modules/claude/claude.module';
import { FFmpegModule } from '../../app/modules/ffmpeg/ffmpeg.module';
import { WhisperModule } from '../../app/modules/whisper/whisper.module';
import { BullQueueModule } from '../bull-queue.module';
import { TrimClipQueueProcessor } from './providers/trim-clip-queue-processor';

@Module({
  imports: [
    BullQueueModule.register('trimClip'),
    ClaudeModule,
    FFmpegModule,
    WhisperModule,
  ],
  providers: [TrimClipQueueProcessor],
})
export class ClipperQueueModule {}
