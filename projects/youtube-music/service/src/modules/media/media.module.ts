import { Module } from '@nestjs/common';
import { FfmpegService } from './ffmpeg.service';
import { YtdlpService } from './ytdlp.service';

@Module({
  providers: [YtdlpService, FfmpegService],
  exports: [YtdlpService, FfmpegService],
})
export class MediaModule {}
