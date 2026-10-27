import { z } from 'zod';

import { defineRedisKeys, redisValue } from '@libs/redis-cache';

export const clientAuthMethodSchema = z.enum([
  'none',
  'client_secret_basic',
  'client_secret_post',
]);

/** A client registered through /oauth/register. */
export const clientSchema = z.object({
  clientId: z.string(),
  clientName: z.string().nullable(),
  authMethod: clientAuthMethodSchema,
  /** Hash of the client secret, for clients that have one (see `hashToken`). */
  secretHash: z.string().nullable(),
  redirectUris: z.string().array(),
});
export type Client = z.infer<typeof clientSchema>;

/** Who a code or token was issued to: the client and the Authelia user who signed in. */
export const grantSchema = z.object({
  clientId: z.string(),
  /** Authelia's `sub` for the user. */
  subject: z.string(),
});
export type Grant = z.infer<typeof grantSchema>;

/**
 * What a code or token carries: the grant (one sign-in) it came from. Every refresh token and
 * access token of one connection shares the grant, so deleting the grant revokes them all.
 */
export const issuedSchema = grantSchema.extend({ grantId: z.string() });
export type Issued = z.infer<typeof issuedSchema>;

/** A sign-in that went to Authelia and hasn't come back yet. */
export const pendingAuthorizationSchema = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  /** The client's state, handed back to it with the code. */
  state: z.string().nullable(),
  codeChallenge: z.string(),
  /** The PKCE verifier and nonce of the request to Authelia. */
  autheliaCodeVerifier: z.string(),
  autheliaNonce: z.string(),
});
export type PendingAuthorization = z.infer<typeof pendingAuthorizationSchema>;

export const authorizationCodeSchema = issuedSchema.extend({
  redirectUri: z.string(),
  codeChallenge: z.string(),
});

export const accessTokenSchema = issuedSchema.extend({
  /** Epoch milliseconds. */
  expiresAt: z.number(),
});

/**
 * Codes and tokens are stored under their hash (`hashToken`), so what's in Redis can't be used to
 * call the service.
 */
export const MCP_REDIS = defineRedisKeys('mcp-service', {
  clients: redisValue('clients', clientSchema, { perId: true }),
  /** By the state sent to Authelia. */
  pendingAuthorizations: redisValue(
    'pending-authorizations',
    pendingAuthorizationSchema,
    { perId: true },
  ),
  authorizationCodes: redisValue(
    'authorization-codes',
    authorizationCodeSchema,
    { perId: true },
  ),
  accessTokens: redisValue('access-tokens', accessTokenSchema, {
    perId: true,
  }),
  refreshTokens: redisValue('refresh-tokens', issuedSchema, { perId: true }),
  /** By grant id. A connection is live while its grant is. */
  grants: redisValue('grants', grantSchema, { perId: true }),
  /**
   * Codes and refresh tokens already used, by hash: a second use means one was stolen, so the
   * grant is revoked.
   */
  spentTokens: redisValue('spent-tokens', z.object({ grantId: z.string() }), {
    perId: true,
  }),
});
