import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { IncomingHttpHeaders } from 'http';

import { extractAuthTokenFromHeader } from '@libs/nest-core';
import type { Id } from '@platform/convex-contracts';

import { EnvironmentService } from '../config/environment';

type AuthedRequest = { headers: IncomingHttpHeaders; userId?: Id<'users'> };

/**
 * Requires `Authorization: Bearer <JWT>` from Convex Auth (what `convexAuthNextjsToken()` returns in
 * finance-web), checked against the deployment's JWKS. The token's subject is `<userId>|<sessionId>`.
 *
 * Tokens last an hour and aren't checked against convex, so signing out doesn't revoke one that's
 * already issued.
 */
@Injectable()
export class ConvexJwtGuard implements CanActivate {
  private readonly logger = new Logger(ConvexJwtGuard.name);
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(environmentService: EnvironmentService) {
    this.issuer = environmentService.environment.convexSiteUrl;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractAuthTokenFromHeader(request.headers);
    if (!token) throw new UnauthorizedException();

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'convex',
        algorithms: ['RS256'],
      });
      const [userId] = (payload.sub ?? '').split('|');
      if (!userId) throw new Error('token has no subject');
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      request.userId = userId as Id<'users'>;
      return true;
    } catch (error) {
      this.logger.debug(
        `Rejected token: ${error instanceof Error ? error.message : error}`,
      );
      throw new UnauthorizedException();
    }
  }
}

/** The user ConvexJwtGuard verified. Only use it on routes behind that guard. */
export const UserId = createParamDecorator(
  (_: unknown, context: ExecutionContext): Id<'users'> => {
    const { userId } = context.switchToHttp().getRequest<AuthedRequest>();
    if (!userId) throw new UnauthorizedException();
    return userId;
  },
);
