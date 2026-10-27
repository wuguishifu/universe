import { z } from 'zod';

import {
  baseEnvironmentSchema,
  commaSeparated,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema.extend({
  /**
   * The origin clients reach this service at. It's the OAuth issuer, and the MCP endpoint is
   * `<publicUrl>/mcp`.
   */
  publicUrl: z.url().transform((url) => new URL(url).origin),
  redisUrl: z.string().min(1),

  /** Authelia does the actual login, with this service as one of its OIDC clients. */
  autheliaUrl: z.url().default('https://auth.wuguishifu.dev'),
  autheliaClientId: z.string().min(1).default('mcp'),
  autheliaClientSecret: z.string().min(1),

  /**
   * Redirect URIs clients may register, besides loopback ones (`http://localhost:<any port>`),
   * which native clients like Claude Code use.
   */
  allowedRedirectUris: z
    .string()
    .default(
      'https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback',
    )
    .pipe(commaSeparated),
  /** Hostnames a browser may call /mcp from (requests without an Origin, like most, always pass). */
  allowedOrigins: z
    .string()
    .default('claude.ai,claude.com,localhost')
    .pipe(commaSeparated),

  accessTokenTtlMinutes: z.coerce.number().positive().default(60),
  /** How long a connection lasts unused: each refresh starts it again. */
  refreshTokenTtlDays: z.coerce.number().positive().default(30),

  thermoAutomationServiceUrl: z.url(),
});

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
