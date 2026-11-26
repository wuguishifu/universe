import { Module } from '@nestjs/common';

import { BullQueueModule } from '@libs/queue';
import { FFMPEG_QUEUE_CONFIG } from '@platform/ffmpeg-contracts';

import { FfmpegProcessor } from './ffmpeg.processor';
import { FfmpegService } from './ffmpeg.service';
import { FilesService } from './files.service';
import { WorkDirService } from './work-dir.service';

@Module({
  imports: [BullQueueModule.register(FFMPEG_QUEUE_CONFIG, 'run')],
  providers: [FfmpegProcessor, FfmpegService, FilesService, WorkDirService],
})
export class FfmpegModule {}
