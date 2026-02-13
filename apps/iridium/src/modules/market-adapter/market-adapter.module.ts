import { Module } from '@nestjs/common';

import { MarketAdapterService } from './market-adapter.service';

@Module({
  providers: [MarketAdapterService],
  exports: [MarketAdapterService],
})
export class AdapterModule {}
