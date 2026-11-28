import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { timingSafeEqual } from 'crypto';

import { extractAuthTokenFromHeader } from '@libs/nest-core';

import { EnvironmentService } from '../config/environment';

/** Requires `Authorization: Bearer <API_TOKEN>`. */
@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(private readonly environmentService: EnvironmentService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = extractAuthTokenFromHeader(request.headers);
    const expected = this.environmentService.environment.apiToken;
    if (token && safeEqual(token, expected)) return true;
    throw new UnauthorizedException();
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
