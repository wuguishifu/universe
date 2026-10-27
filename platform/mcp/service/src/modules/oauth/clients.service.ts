import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { RedisCacheService } from '@libs/nest-redis-cache';

import { EnvironmentService } from '../../config/environment';
import {
  type Client,
  clientAuthMethodSchema,
  MCP_REDIS,
} from '../../config/redis-keys';

import { hashToken, randomToken, safeEqual } from './tokens';

/** Unused clients are forgotten after this; issuing a token starts it again. */
const CLIENT_TTL_SECONDS = 365 * 24 * 60 * 60;

/** RFC 8252: native apps listen on a loopback port of their choosing. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** HTTP Basic credentials, each part form-encoded (RFC 6749 2.3.1). */
function parseBasic(
  credentials: string,
): { clientId: string; secret: string } | undefined {
  const decoded = Buffer.from(credentials, 'base64').toString();
  const separator = decoded.indexOf(':');
  if (separator === -1) return undefined;
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      secret: decodeURIComponent(decoded.slice(separator + 1)),
    };
  } catch {
    return undefined;
  }
}

/** RFC 7591 client metadata. Fields this server doesn't use are dropped. */
const registrationSchema = z.object({
  redirect_uris: z.string().array().min(1),
  token_endpoint_auth_method: clientAuthMethodSchema.default(
    'client_secret_basic',
  ),
  grant_types: z
    .enum(['authorization_code', 'refresh_token'])
    .array()
    .default(['authorization_code']),
  response_types: z.literal('code').array().default(['code']),
  client_name: z.string().optional(),
});

/**
 * Dynamic client registration (RFC 7591), which is how claude.ai and Claude Code get a client id.
 * Anyone who can reach the endpoint can register, so what keeps codes from going somewhere
 * they shouldn't is the redirect URI allowlist.
 */
@Injectable()
export class ClientsService {
  private readonly allowedRedirectUris: Set<string>;

  constructor(
    environmentService: EnvironmentService,
    private readonly redis: RedisCacheService,
  ) {
    this.allowedRedirectUris = new Set(
      environmentService.environment.allowedRedirectUris,
    );
  }

  async register(body: unknown) {
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      throw new OAuthError(
        OAuthErrorCode.InvalidClientMetadata,
        z.prettifyError(parsed.error),
      );
    }
    const metadata = parsed.data;
    const rejected = metadata.redirect_uris.find(
      (uri) => !this.isAllowedRedirectUri(uri),
    );
    if (rejected) {
      throw new OAuthError(
        OAuthErrorCode.InvalidRedirectUri,
        `${rejected} isn't an allowed redirect URI`,
      );
    }

    const clientId = randomToken();
    const secret =
      metadata.token_endpoint_auth_method === 'none' ? null : randomToken();
    const client: Client = {
      clientId,
      clientName: metadata.client_name ?? null,
      authMethod: metadata.token_endpoint_auth_method,
      secretHash: secret && hashToken(secret),
      redirectUris: metadata.redirect_uris,
    };
    await this.save(client);

    return {
      ...metadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
    };
  }

  find(clientId: string): Promise<Client | undefined> {
    return this.redis.get({ key: MCP_REDIS.clients, id: clientId });
  }

  /**
   * The client making a token request. Clients with a secret may send it either way (Basic or in
   * the body), whatever they registered with: some send the other.
   */
  async authenticate(
    body: { client_id?: string; client_secret?: string },
    authorization: string | undefined,
  ): Promise<Client> {
    const { clientId, secret } = (authorization?.startsWith('Basic ') &&
      parseBasic(authorization.slice(6))) || {
      clientId: body.client_id,
      secret: body.client_secret,
    };

    const client = clientId ? await this.find(clientId) : undefined;
    const authenticated =
      client &&
      (client.secretHash === null ||
        (secret !== undefined &&
          safeEqual(hashToken(secret), client.secretHash)));
    if (!authenticated) {
      throw new OAuthError(
        OAuthErrorCode.InvalidClient,
        'Unknown client or wrong secret',
      );
    }
    return client;
  }

  /** Keeps a client in use from expiring. */
  async save(client: Client) {
    await this.redis.set({
      key: MCP_REDIS.clients,
      id: client.clientId,
      value: client,
      ttlSeconds: CLIENT_TTL_SECONDS,
    });
  }

  private isAllowedRedirectUri(uri: string): boolean {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      return false;
    }
    if (url.hash) return false;
    if (url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname)) {
      return true;
    }
    return this.allowedRedirectUris.has(uri);
  }
}
