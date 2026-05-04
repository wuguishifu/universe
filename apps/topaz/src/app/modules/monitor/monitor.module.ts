import { Module } from '@nestjs/common';
import { MonitorService } from './monitor.service';
import { WatchConfigService } from './watch-config.service';

@Module({
  providers: [WatchConfigService, MonitorService],
})
export class MonitorModule {}
