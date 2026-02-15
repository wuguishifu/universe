import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-headerapikey';

import { BEARER_GUARD } from '../../config/constants';

@Injectable()
export class BearerStrategy extends PassportStrategy(Strategy, BEARER_GUARD) {
  private readonly apiAccessKey: string;

  constructor() {
    super({ header: 'Authorization', prefix: 'Bearer ' }, false);

    if (!process.env.OSMIUM_API_ACCESS_KEY) {
      throw new Error('OSMIUM_API_ACCESS_KEY environment variable is not set');
    }

    this.apiAccessKey = process.env.OSMIUM_API_ACCESS_KEY;
  }

  validate(apiKey: string): boolean {
    if (apiKey === this.apiAccessKey) {
      return true;
    }
    throw new UnauthorizedException();
  }
}
