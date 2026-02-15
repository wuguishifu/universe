import { Module } from '@nestjs/common';

import { MergeService } from './merge.service';
import { DataModule } from '../data/data.module';
import { RelayerModule } from '../relayer/relayer.module';

@Module({
  imports: [DataModule, RelayerModule],
  providers: [MergeService],
})
export class MergeModule {}
