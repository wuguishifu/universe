import { Module } from '@nestjs/common';

import { BinancePriceService } from './binance-price.service';
import { BinanceWsService } from './binance-ws.service';

@Module({
  providers: [BinanceWsService, BinancePriceService],
  exports: [BinancePriceService],
})
export class BinanceModule {}
