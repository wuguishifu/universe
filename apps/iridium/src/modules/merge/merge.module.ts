import { Module } from '@nestjs/common';

import { MergeService } from './merge.service';
import { CacheModule } from '../cache/cache.module';
import { ClaimModule } from '../claim/claim.module';
import { ClobClientModule } from '../clob/client/clob-client.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { PositionModule } from '../position/position.module';

@Module({
  imports: [ClobClientModule, CacheModule, ClaimModule, ExecutionModule, LedgerModule, PositionModule],
  providers: [MergeService],
})
export class MergeModule {}
