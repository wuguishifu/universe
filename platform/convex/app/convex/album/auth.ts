import { ConvexError, v } from 'convex/values';

/**
 * The album's writes come from janktm-service over HTTP, and a deployment URL isn't a secret, so
 * each write takes this argument, which must match the deployment's JANKTM_CONVEX_SECRET env var.
 * Call assertJanktmSecret first thing in every handler that takes it.
 */
export const janktmSecret = v.string();

export function assertJanktmSecret(secret: string): void {
  const expected = process.env.JANKTM_CONVEX_SECRET;
  if (!expected) {
    throw new ConvexError('JANKTM_CONVEX_SECRET is not set on this deployment');
  }
  if (secret !== expected) {
    throw new ConvexError('Unauthorized');
  }
}
