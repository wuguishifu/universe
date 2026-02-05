import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { BearerStrategy } from './strategies/bearer.strategy';

@Module({
  imports: [PassportModule],
  providers: [BearerStrategy],
  exports: [PassportModule],
})
export class AuthModule {}
