import { Module } from '@nestjs/common';

import { BinanceKlineWsService } from './binance-kline-ws.service';
import { BinancePriceService } from './binance-price.service';
import { BinanceWsService } from './binance-ws.service';

@Module({
  providers: [BinanceWsService, BinanceKlineWsService, BinancePriceService],
  exports: [BinancePriceService],
})
export class BinanceModule {}
