import { Global, Module } from '@nestjs/common';

import { TokenCipherService } from '../crypto/token-cipher.service';
import { PlaidService } from '../plaid/plaid.service';

import { ConvexService } from './convex.service';

@Global()
@Module({
  providers: [ConvexService, PlaidService, TokenCipherService],
  exports: [ConvexService, PlaidService, TokenCipherService],
})
export class CommonModule {}
