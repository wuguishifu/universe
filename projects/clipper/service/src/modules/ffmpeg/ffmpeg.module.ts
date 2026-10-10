import { Module } from '@nestjs/common';

import { FFmpegService } from './ffmpeg.service';
import { FFprobeService } from './ffprobe.service';

@Module({
  providers: [FFmpegService, FFprobeService],
  exports: [FFmpegService, FFprobeService],
})
export class FFmpegModule {}
