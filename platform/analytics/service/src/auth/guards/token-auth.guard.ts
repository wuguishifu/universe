import {
  CanActivate,
  ExecutionContext,
  Injectable,
  mixin,
  Type,
  UnauthorizedException,
} from '@nestjs/common';

import { extractAuthTokenFromHeader } from '@libs/nest-common';
import { EnvironmentSchema } from '../../environment/environment-schema';
import { EnvironmentService } from '../../environment/environment-service';

export function TokenAuthGuard(
  envKey: keyof EnvironmentSchema,
): Type<CanActivate> {
  @Injectable()
  class TokenAuthGuardMixin implements CanActivate {
    constructor(private readonly environmentService: EnvironmentService) {}

    canActivate(context: ExecutionContext): boolean {
      const request = context.switchToHttp().getRequest();
      const token = extractAuthTokenFromHeader(request.headers);

      if (token === this.environmentService.environment[envKey]) return true;

      throw new UnauthorizedException();
    }
  }

  return mixin(TokenAuthGuardMixin);
}
