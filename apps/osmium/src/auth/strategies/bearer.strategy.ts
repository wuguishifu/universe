import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-headerapikey';

import { ConfigService } from '@wuguishifu/nest-common';

import { BEARER_GUARD } from '../../config/constants';

@Injectable()
export class BearerStrategy extends PassportStrategy(Strategy, BEARER_GUARD) {
  constructor(private readonly configService: ConfigService) {
    super({ header: 'Authorization', prefix: 'Bearer ' }, false);
  }

  validate(apiKey: string): boolean {
    if (apiKey === this.configService.config.osmium.apiAccessKey) {
      return true;
    }
    throw new UnauthorizedException();
  }
}
