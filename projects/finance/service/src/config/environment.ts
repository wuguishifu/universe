import { z } from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema.extend({
  plaidClientId: z.string().min(1),
  plaidClientSecret: z.string().min(1),
  /** The secret in Infisical decides which of these works. */
  plaidEnv: z.enum(['sandbox', 'production']).default('sandbox'),
  /**
   * 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts Plaid access tokens before they go
   * to convex. Only this service has it.
   */
  plaidTokenKey: z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32) {
        ctx.addIssue({
          code: 'custom',
          message: 'PLAID_TOKEN_KEY must be 32 bytes, base64-encoded',
        });
        return z.NEVER;
      }
      return key;
    }),

  convexUrl: z.url(),
  /** Convex Auth's JWT issuer; its JWKS is at /.well-known/jwks.json. */
  convexSiteUrl: z.url().transform((value) => value.replace(/\/+$/, '')),
  /** Must match FINANCE_CONVEX_SECRET on the convex deployment. */
  financeConvexSecret: z.string().min(16),
});

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
