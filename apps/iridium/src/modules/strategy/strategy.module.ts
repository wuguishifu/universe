import { Module } from '@nestjs/common';

import { StrategyService } from './strategy.service';
import { ClobWsModule } from '../clob/ws/clob-ws.module';

@Module({
  imports: [ClobWsModule],
  providers: [StrategyService],
})
export class StrategyModule {}
