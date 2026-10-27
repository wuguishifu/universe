import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { EnvironmentService } from '../../config/environment';

import { hashToken } from './tokens';

const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
});
type Discovery = z.infer<typeof discoverySchema>;

const tokenResponseSchema = z.object({ id_token: z.string() });

const idTokenClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.string().array()]),
  sub: z.string().min(1),
  nonce: z.string(),
  exp: z.number(),
});

const TIMEOUT_MS = 10_000;

/**
 * This service as an OIDC client of Authelia, which does the actual sign-in (two factors, and
 * only for users its `mcp` authorization policy allows). In the cluster, auth.wuguishifu.dev
 * resolves to Traefik through the CoreDNS rewrite, so Authelia never has to be public: only the
 * user's browser, on the tailnet, visits it.
 */
@Injectable()
export class AutheliaService {
  private discovery: Promise<Discovery> | undefined;
  private readonly autheliaUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(environmentService: EnvironmentService) {
    const { autheliaUrl, autheliaClientId, autheliaClientSecret, publicUrl } =
      environmentService.environment;
    this.autheliaUrl = autheliaUrl;
    this.clientId = autheliaClientId;
    this.clientSecret = autheliaClientSecret;
    this.redirectUri = `${publicUrl}/oauth/callback`;
  }

  /** Where to send the browser to sign in. Authelia comes back to /oauth/callback. */
  async authorizationUrl(params: {
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<string> {
    const { authorization_endpoint } = await this.discover();
    const url = new URL(authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: 'openid',
      state: params.state,
      nonce: params.nonce,
      code_challenge: hashToken(params.codeVerifier),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Exchanges the code Authelia came back with for the signed-in user's `sub`. */
  async subjectFor(params: {
    code: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<string> {
    const { issuer, token_endpoint } = await this.discover();
    const credentials = `${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`;
    const response = await fetch(token_endpoint, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(credentials).toString('base64')}`,
        accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: params.code,
        redirect_uri: this.redirectUri,
        code_verifier: params.codeVerifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        `Authelia's token endpoint answered ${response.status}: ${await response.text()}`,
      );
    }
    const { id_token } = tokenResponseSchema.parse(await response.json());

    // The ID token came straight from Authelia's token endpoint over TLS, so its signature
    // doesn't need checking (OIDC Core 3.1.3.7, item 6). Its claims still do.
    const [, payload = ''] = id_token.split('.');
    const claims = idTokenClaimsSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer) {
      throw new Error(`ID token issued by ${claims.iss}, not ${issuer}`);
    }
    if (!audiences.includes(this.clientId)) {
      throw new Error(`ID token isn't for ${this.clientId}`);
    }
    if (claims.nonce !== params.nonce) {
      throw new Error("ID token nonce doesn't match");
    }
    if (claims.exp * 1000 < Date.now()) {
      throw new Error('ID token expired');
    }
    return claims.sub;
  }

  /** Read once, and again after a failure. */
  private discover(): Promise<Discovery> {
    this.discovery ??= this.fetchDiscovery().catch((error: unknown) => {
      this.discovery = undefined;
      throw error;
    });
    return this.discovery;
  }

  private async fetchDiscovery(): Promise<Discovery> {
    const response = await fetch(
      new URL('/.well-known/openid-configuration', this.autheliaUrl),
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!response.ok) {
      throw new Error(`Authelia's discovery answered ${response.status}`);
    }
    return discoverySchema.parse(await response.json());
  }
}
