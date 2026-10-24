import { Module } from '@nestjs/common';

import { DaikinService } from './daikin.service';

@Module({
  providers: [DaikinService],
  exports: [DaikinService],
})
export class DaikinModule {}
