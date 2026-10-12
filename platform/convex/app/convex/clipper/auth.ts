import { ConvexError, v } from 'convex/values';

/**
 * Clipper's functions are public (clipper-service writes over HTTP and the Windows client
 * subscribes) and a deployment URL isn't a secret, so each one takes this argument, which must
 * match the deployment's CLIPPER_CONVEX_SECRET env var. Call assertClipperSecret first thing in
 * every handler.
 */
export const clipperSecret = v.string();

export function assertClipperSecret(secret: string): void {
  const expected = process.env.CLIPPER_CONVEX_SECRET;
  if (!expected) {
    throw new ConvexError(
      'CLIPPER_CONVEX_SECRET is not set on this deployment',
    );
  }
  if (secret !== expected) {
    throw new ConvexError('Unauthorized');
  }
}
