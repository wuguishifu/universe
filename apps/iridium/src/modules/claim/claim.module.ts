import { Module } from '@nestjs/common';

import { ClaimService } from './claim.service';
import { ClobClientModule } from '../clob/client/clob-client.module';
import { ExecutionModule } from '../execution/execution.module';

@Module({
  imports: [ClobClientModule, ExecutionModule],
  providers: [ClaimService],
  exports: [ClaimService],
})
export class ClaimModule {}
