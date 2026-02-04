import { Module } from '@nestjs/common';

import { StrategyService } from './strategy.service';
import { ClobWsModule } from '../clob/ws/clob-ws.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [ClobWsModule, ExecutionModule, LedgerModule],
  providers: [StrategyService],
})
export class StrategyModule {}
