import { Module } from '@nestjs/common';

import { ClobClientModule } from '@wuguishifu/nest-polymarket';

import { LedgerService } from './ledger.service';

@Module({
  imports: [ClobClientModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
