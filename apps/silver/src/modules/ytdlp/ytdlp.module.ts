import { Module } from '@nestjs/common';
import { YtDlpService } from './ytdlp.service';

@Module({
  providers: [YtDlpService],
  exports: [YtDlpService],
})
export class YtDlpModule {}
