import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extractAuthTokenFromHeader } from '@libs/nest-common';
import { EnvironmentService } from '../environment/environment';

const IS_PUBLIC = 'isPublic';

/** Lets a route through without a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Lets a route take the token as `?token=` too, for media players that can't send headers. */
const ALLOWS_QUERY_TOKEN = 'allowsQueryToken';
export const AllowQueryToken = () => SetMetadata(ALLOWS_QUERY_TOKEN, true);

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Applied to every route (see AppModule): there's one user, with one token. */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(
    private readonly reflector: Reflector,
    environmentService: EnvironmentService,
  ) {
    this.expected = digest(environmentService.environment.apiToken);
  }

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      query?: Record<string, unknown>;
    }>();
    let token = extractAuthTokenFromHeader(request.headers);
    if (
      !token &&
      this.reflector.getAllAndOverride<boolean>(ALLOWS_QUERY_TOKEN, targets) &&
      typeof request.query?.token === 'string'
    ) {
      token = request.query.token;
    }

    // Compared as digests so it takes as long however much of the token is right.
    if (token && timingSafeEqual(digest(token), this.expected)) return true;
    throw new UnauthorizedException();
  }
}
