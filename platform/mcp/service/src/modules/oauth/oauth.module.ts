import { Module } from '@nestjs/common';

import { AutheliaService } from './authelia.service';
import { ClientsService } from './clients.service';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

@Module({
  controllers: [OAuthController],
  providers: [AutheliaService, ClientsService, OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
