import { Module } from '@nestjs/common';

import { ClobClientService } from './clob-client.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [ClobClientService],
  exports: [ClobClientService],
})
export class ClobClientModule {}
