import {
  type AuthInfo,
  buildOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  type OAuthMetadata,
  type OAuthProtectedResourceMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { RedisCacheService } from '@libs/nest-redis-cache';

import { EnvironmentService } from '../../config/environment';
import { type Grant, MCP_REDIS } from '../../config/redis-keys';

import { AutheliaService } from './authelia.service';
import { ClientsService } from './clients.service';
import { hashToken, randomToken, safeEqual } from './tokens';

/** Long enough to sign in at Authelia. */
const PENDING_AUTHORIZATION_TTL_SECONDS = 10 * 60;
const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

const authorizeQuerySchema = z.object({
  client_id: z.string(),
  redirect_uri: z.string(),
  response_type: z.string().optional(),
  state: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  resource: z.string().optional(),
});

const callbackQuerySchema = z.object({
  state: z.string(),
  code: z.string().optional(),
  error: z.string().optional(),
});

const tokenRequestSchema = z.object({
  grant_type: z.string(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  code: z.string().optional(),
  redirect_uri: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  resource: z.string().optional(),
});

/** Compares resource indicators, ignoring a trailing slash. */
const sameResource = (a: string, b: string) =>
  a.replace(/\/$/, '') === b.replace(/\/$/, '');

/**
 * The OAuth 2.1 authorization server MCP clients see. It has no users of its own: /authorize sends
 * the browser to Authelia, and once Authelia comes back to /callback it gives the client a code
 * for its own tokens. Tokens are opaque and live in Redis, so deleting a key revokes one.
 */
@Injectable()
export class OAuthService implements OAuthTokenVerifier {
  private readonly logger = new Logger(OAuthService.name);

  readonly issuer: string;
  /** The MCP endpoint, which tokens are for (RFC 8707). */
  readonly resource: string;
  readonly resourceMetadataUrl: string;
  readonly metadata: OAuthMetadata;
  readonly protectedResourceMetadata: OAuthProtectedResourceMetadata;

  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlSeconds: number;

  constructor(
    environmentService: EnvironmentService,
    private readonly redis: RedisCacheService,
    private readonly clients: ClientsService,
    private readonly authelia: AutheliaService,
  ) {
    const { publicUrl, accessTokenTtlMinutes, refreshTokenTtlDays } =
      environmentService.environment;
    this.issuer = publicUrl;
    this.resource = `${publicUrl}/mcp`;
    this.resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
      new URL(this.resource),
    );
    this.accessTokenTtlSeconds = accessTokenTtlMinutes * 60;
    this.refreshTokenTtlSeconds = refreshTokenTtlDays * 24 * 60 * 60;

    this.metadata = {
      issuer: this.issuer,
      authorization_endpoint: `${publicUrl}/oauth/authorize`,
      token_endpoint: `${publicUrl}/oauth/token`,
      registration_endpoint: `${publicUrl}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: [
        'none',
        'client_secret_basic',
        'client_secret_post',
      ],
      authorization_response_iss_parameter_supported: true,
    };
    // Also checks the issuer is HTTPS, other than on localhost.
    this.protectedResourceMetadata = buildOAuthProtectedResourceMetadata({
      oauthMetadata: this.metadata,
      resourceServerUrl: new URL(this.resource),
      resourceName: 'universe',
      dangerouslyAllowInsecureIssuerUrl:
        new URL(publicUrl).hostname === 'localhost',
    });
  }

  /**
   * Checks the request and returns where to send the browser: Authelia, or back to the client
   * with an error. Throws when there's no trustworthy redirect URI to report an error to.
   */
  async authorize(query: unknown): Promise<string> {
    const parsed = authorizeQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new OAuthError(
        OAuthErrorCode.InvalidRequest,
        'client_id and redirect_uri are required',
      );
    }
    const params = parsed.data;
    const client = await this.clients.find(params.client_id);
    if (!client) {
      throw new OAuthError(
        OAuthErrorCode.InvalidClient,
        'Unknown client. Remove the connection and add it again.',
      );
    }
    if (!client.redirectUris.includes(params.redirect_uri)) {
      throw new OAuthError(
        OAuthErrorCode.InvalidRequest,
        "redirect_uri isn't one the client registered",
      );
    }

    const fail = (error: OAuthErrorCode, description: string) =>
      this.redirectUrl(params.redirect_uri, params.state, {
        error,
        error_description: description,
      });
    if (params.response_type !== 'code') {
      return fail(
        OAuthErrorCode.UnsupportedResponseType,
        'Only response_type=code is supported',
      );
    }
    if (!params.code_challenge || params.code_challenge_method !== 'S256') {
      return fail(OAuthErrorCode.InvalidRequest, 'PKCE with S256 is required');
    }
    if (params.resource && !sameResource(params.resource, this.resource)) {
      return fail(
        OAuthErrorCode.InvalidTarget,
        `This server only issues tokens for ${this.resource}`,
      );
    }

    const autheliaState = randomToken();
    const autheliaCodeVerifier = randomToken();
    const autheliaNonce = randomToken();
    await this.redis.set({
      key: MCP_REDIS.pendingAuthorizations,
      id: autheliaState,
      value: {
        clientId: client.clientId,
        redirectUri: params.redirect_uri,
        state: params.state ?? null,
        codeChallenge: params.code_challenge,
        autheliaCodeVerifier,
        autheliaNonce,
      },
      ttlSeconds: PENDING_AUTHORIZATION_TTL_SECONDS,
    });
    return this.authelia.authorizationUrl({
      state: autheliaState,
      nonce: autheliaNonce,
      codeVerifier: autheliaCodeVerifier,
    });
  }

  /**
   * Where Authelia sends the browser after sign-in. Returns the client's redirect URI, with a
   * code or an error. Throws when the sign-in is unknown or expired.
   */
  async callback(query: unknown): Promise<string> {
    const parsed = callbackQuerySchema.safeParse(query);
    const pending =
      parsed.success &&
      (await this.redis.take({
        key: MCP_REDIS.pendingAuthorizations,
        id: parsed.data.state,
      }));
    if (!parsed.success || !pending) {
      throw new OAuthError(
        OAuthErrorCode.InvalidRequest,
        'This sign-in expired or was already used. Start again from the app you were connecting.',
      );
    }
    const { code, error } = parsed.data;
    if (error || !code) {
      return this.redirectUrl(pending.redirectUri, pending.state, {
        error: OAuthErrorCode.AccessDenied,
        error_description: `Authelia: ${error ?? 'no code'}`,
      });
    }

    let subject: string;
    try {
      subject = await this.authelia.subjectFor({
        code,
        codeVerifier: pending.autheliaCodeVerifier,
        nonce: pending.autheliaNonce,
      });
    } catch (exchangeError) {
      this.logger.error('Authelia code exchange failed', exchangeError);
      return this.redirectUrl(pending.redirectUri, pending.state, {
        error: OAuthErrorCode.ServerError,
        error_description: "Couldn't complete the Authelia sign-in",
      });
    }

    const authorizationCode = randomToken();
    await this.redis.set({
      key: MCP_REDIS.authorizationCodes,
      id: hashToken(authorizationCode),
      value: {
        clientId: pending.clientId,
        subject,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
      },
      ttlSeconds: AUTHORIZATION_CODE_TTL_SECONDS,
    });
    return this.redirectUrl(pending.redirectUri, pending.state, {
      code: authorizationCode,
    });
  }

  async token(body: unknown, authorization: string | undefined) {
    const parsed = tokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new OAuthError(
        OAuthErrorCode.InvalidRequest,
        'grant_type is required',
      );
    }
    const params = parsed.data;
    const client = await this.clients.authenticate(params, authorization);
    if (params.resource && !sameResource(params.resource, this.resource)) {
      throw new OAuthError(
        OAuthErrorCode.InvalidTarget,
        `This server only issues tokens for ${this.resource}`,
      );
    }

    let grant: Grant | undefined;
    switch (params.grant_type) {
      case 'authorization_code': {
        const code =
          params.code &&
          (await this.redis.take({
            key: MCP_REDIS.authorizationCodes,
            id: hashToken(params.code),
          }));
        const valid =
          code &&
          code.clientId === client.clientId &&
          (params.redirect_uri === undefined ||
            params.redirect_uri === code.redirectUri) &&
          params.code_verifier !== undefined &&
          safeEqual(hashToken(params.code_verifier), code.codeChallenge);
        grant = valid ? code : undefined;
        break;
      }
      case 'refresh_token': {
        // Refresh tokens are single use: each refresh gets a new one (OAuth 2.1, public clients).
        const stored =
          params.refresh_token &&
          (await this.redis.take({
            key: MCP_REDIS.refreshTokens,
            id: hashToken(params.refresh_token),
          }));
        grant =
          stored && stored.clientId === client.clientId ? stored : undefined;
        break;
      }
      default:
        throw new OAuthError(
          OAuthErrorCode.UnsupportedGrantType,
          'Use authorization_code or refresh_token',
        );
    }
    if (!grant) {
      throw new OAuthError(
        OAuthErrorCode.InvalidGrant,
        'The code or refresh token is invalid, expired or already used',
      );
    }

    await this.clients.save(client);
    return this.issueTokens({
      clientId: grant.clientId,
      subject: grant.subject,
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = await this.redis.get({
      key: MCP_REDIS.accessTokens,
      id: hashToken(token),
    });
    if (!stored) {
      throw new OAuthError(
        OAuthErrorCode.InvalidToken,
        'Unknown or expired token',
      );
    }
    return {
      token,
      clientId: stored.clientId,
      scopes: [],
      expiresAt: Math.floor(stored.expiresAt / 1000),
      resource: new URL(this.resource),
      extra: { subject: stored.subject },
    };
  }

  private async issueTokens(grant: Grant) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    await Promise.all([
      this.redis.set({
        key: MCP_REDIS.accessTokens,
        id: hashToken(accessToken),
        value: {
          ...grant,
          expiresAt: Date.now() + this.accessTokenTtlSeconds * 1000,
        },
        ttlSeconds: this.accessTokenTtlSeconds,
      }),
      this.redis.set({
        key: MCP_REDIS.refreshTokens,
        id: hashToken(refreshToken),
        value: grant,
        ttlSeconds: this.refreshTokenTtlSeconds,
      }),
    ]);
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenTtlSeconds,
      refresh_token: refreshToken,
    };
  }

  /** The client's redirect URI with `params`, its state, and `iss` (RFC 9207). */
  private redirectUrl(
    redirectUri: string,
    state: string | null | undefined,
    params: Record<string, string>,
  ): string {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }
    if (state) url.searchParams.set('state', state);
    url.searchParams.set('iss', this.issuer);
    return url.toString();
  }
}
