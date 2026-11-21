import { Module } from '@nestjs/common';

import { TradingStore } from '../persistence/trading-store';

import { BotService } from './bot.service';

@Module({
  providers: [TradingStore, BotService],
  exports: [BotService],
})
export class BotModule {}
