import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';
import { EnvironmentService } from '../environment/environment-service';
import { IS_PUBLIC_KEY } from './public.decorator';

/** Requires `Authorization: Bearer <API_TOKEN>` on every non-public route. */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly expectedDigest: Buffer;

  constructor(
    private readonly reflector: Reflector,
    environmentService: EnvironmentService,
  ) {
    this.expectedDigest = digest(environmentService.environment.apiToken);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    // Compare fixed-length digests so the check doesn't leak the token length or prefix.
    if (
      scheme !== 'Bearer' ||
      !token ||
      !timingSafeEqual(digest(token), this.expectedDigest)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
