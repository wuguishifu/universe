import { Module } from '@nestjs/common';

import { MergeService } from './merge.service';
import { RelayerModule } from '../relayer/relayer.module';

@Module({
  imports: [RelayerModule],
  providers: [MergeService],
  exports: [MergeService],
})
export class MergeModule {}
