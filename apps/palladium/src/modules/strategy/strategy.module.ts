import { Module } from '@nestjs/common';

import { BinanceModule } from '../binance/binance.module';
import { CacheModule } from '../cache/cache.module';
import { ClobWsModule } from '../clob-ws/clob-ws.module';
import { ExecutionModule } from '../execution/execution.module';
import { LedgerModule } from '../ledger/ledger.module';
import { MarketAdapterModule } from '../market-adapter/market-adapter.module';
import { AlphaService } from './components/alpha.service';
import { StrategyService } from './strategy.service';

@Module({
  imports: [BinanceModule, CacheModule, ClobWsModule, ExecutionModule, LedgerModule, MarketAdapterModule],
  providers: [StrategyService, AlphaService],
})
export class StrategyModule {}
