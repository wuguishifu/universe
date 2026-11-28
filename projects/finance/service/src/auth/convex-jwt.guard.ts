import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import type { IncomingHttpHeaders } from 'http';

import { extractAuthTokenFromHeader } from '@libs/nest-core';
import type { Id } from '@platform/convex-contracts';

import { EnvironmentService } from '../config/environment';
import { ConvexService } from '../modules/common/convex.service';

type AuthedRequest = { headers: IncomingHttpHeaders; userId?: Id<'users'> };

/**
 * Requires `Authorization: Bearer <JWT>` from Convex Auth (what `convexAuthNextjsToken()` returns in
 * finance-web), checked against the deployment's JWKS. The token's subject is `<userId>|<sessionId>`.
 * Accounts are shared by every app on the deployment, so the user also needs a `finance` grant
 * (platform/convex/app/convex/access), which is checked with convex on every request: 403 without.
 *
 * Signing out doesn't revoke a token that's already issued (they last an hour), but revoking the
 * grant or deleting the account takes effect on the next request.
 */
@Injectable()
export class ConvexJwtGuard implements CanActivate {
  private readonly logger = new Logger(ConvexJwtGuard.name);
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    environmentService: EnvironmentService,
    private readonly convexService: ConvexService,
  ) {
    this.issuer = environmentService.environment.convexSiteUrl;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractAuthTokenFromHeader(request.headers);
    if (!token) throw new UnauthorizedException();

    const userId = await this.verifiedUserId(token);
    if (!userId) throw new UnauthorizedException();
    // Not caught: if convex can't answer, fail the request rather than let it through.
    if (!(await this.convexService.canUseFinance(token))) {
      throw new ForbiddenException();
    }
    request.userId = userId;
    return true;
  }

  private async verifiedUserId(token: string): Promise<Id<'users'> | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: 'convex',
        algorithms: ['RS256'],
      });
      const [userId] = (payload.sub ?? '').split('|');
      if (!userId) throw new Error('token has no subject');
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return userId as Id<'users'>;
    } catch (error) {
      this.logger.debug(
        `Rejected token: ${error instanceof Error ? error.message : error}`,
      );
      return null;
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
