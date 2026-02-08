import { Module } from '@nestjs/common';

import { ClobWsModule } from '../clob/ws/clob-ws.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { AlphaService } from './components/alpha.service';
import { PositionService } from './components/position.service';
import { StraddleManagerService } from './components/straddle-manager.service';
import { StrategyService } from './strategy.service';

@Module({
  imports: [ClobWsModule, ExecutionModule, LedgerModule],
  providers: [StrategyService, AlphaService, PositionService, StraddleManagerService],
})
export class StrategyModule {}
