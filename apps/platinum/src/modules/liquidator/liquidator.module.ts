import { Module } from '@nestjs/common';

import { DataModule } from '../data/data.module';
import { RelayerModule } from '../relayer/relayer.module';
import { ConditionalTokensService } from './components/conditional-tokens.service';
import { PositionMathService } from './components/position-math.service';
import { LiquidatorCronService } from './liquidator-cron.service';
import { LiquidatorService } from './liquidator.service';

@Module({
  imports: [DataModule, RelayerModule],
  providers: [LiquidatorService, LiquidatorCronService, ConditionalTokensService, PositionMathService],
})
export class LiquidatorModule {}
