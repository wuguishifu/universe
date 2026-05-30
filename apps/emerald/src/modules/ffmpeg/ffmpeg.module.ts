import { Module } from '@nestjs/common';

import { FFmpegService } from './ffmpeg.service';
import { VideoDataService } from './video-data.service';

@Module({
  providers: [FFmpegService, VideoDataService],
  exports: [FFmpegService, VideoDataService],
})
export class FFmpegModule {}
