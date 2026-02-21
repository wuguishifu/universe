import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { ClobClientService } from './clob-client.service';

@Module({
  imports: [AuthModule],
  providers: [ClobClientService],
  exports: [ClobClientService],
})
export class ClobClientModule {}
