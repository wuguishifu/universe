import { Module } from '@nestjs/common';

import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob/ws/clob-ws.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { AlphaService } from './components/alpha.service';
import { InventorySkewService } from './components/inventory-skew.service';
import { PositionService } from './components/position.service';
import { StraddleManagerService } from './components/straddle-manager.service';
import { StrategyService } from './strategy.service';

@Module({
  imports: [CacheModule, ClobWsModule, ExecutionModule, LedgerModule],
  providers: [StrategyService, AlphaService, PositionService, StraddleManagerService, InventorySkewService],
})
export class StrategyModule {}
