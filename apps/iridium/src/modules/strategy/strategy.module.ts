import { Module } from '@nestjs/common';

import { BinanceModule } from '../binance/binance.module';
import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob/ws/clob-ws.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MarketAdapterModule } from '../market-adapter/market-adapter.module';
import { PositionModule } from '../position/position.module';
import { AlphaService } from './components/alpha.service';
import { InventorySkewService } from './components/inventory-skew.service';
import { StraddleManagerService } from './components/straddle-manager.service';
import { StrategyService } from './strategy.service';

@Module({
  imports: [
    BinanceModule,
    CacheModule,
    ClobWsModule,
    ExecutionModule,
    LedgerModule,
    PositionModule,
    MarketAdapterModule,
  ],
  providers: [StrategyService, AlphaService, StraddleManagerService, InventorySkewService],
})
export class StrategyModule {}
