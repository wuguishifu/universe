import { Module } from '@nestjs/common';

import { LedgerService } from './ledger.service';
import { ClobClientModule } from '../clob/client/clob-client.module';

@Module({
  imports: [ClobClientModule],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
