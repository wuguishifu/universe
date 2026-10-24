import { Module } from '@nestjs/common';

import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { MegaCliService } from './mega-cli.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  providers: [MegaCliService, AccountService, TransfersService, LiveService],
  controllers: [TransfersController, AccountController, LiveController],
})
export class MegaModule {}
