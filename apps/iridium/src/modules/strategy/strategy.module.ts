import { Module } from '@nestjs/common';

import { StrategyService } from './strategy.service';
import { ClobWsModule } from '../clob/ws/clob-ws.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { AlphaService } from './components/alpha.service';
import { PositionService } from './components/position.service';

@Module({
  imports: [ClobWsModule, ExecutionModule, LedgerModule],
  providers: [StrategyService, AlphaService, PositionService],
})
export class StrategyModule {}
