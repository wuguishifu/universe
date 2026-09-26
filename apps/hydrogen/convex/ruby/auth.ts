import { ConvexError, v } from 'convex/values';

/**
 * Ruby's functions are public (the bot calls them over HTTP) and a deployment URL isn't a
 * secret, so each one takes this argument, which must match the deployment's
 * RUBY_CONVEX_SECRET env var. Call assertRubySecret first thing in every handler.
 *
 * (Not a convex-helpers customQuery: with this repo's hoisted node_modules, convex-helpers and
 * hydrogen see different copies of `convex`, and their types don't line up.)
 */
export const rubySecret = v.string();

export function assertRubySecret(secret: string): void {
  const expected = process.env.RUBY_CONVEX_SECRET;
  if (!expected) {
    throw new ConvexError('RUBY_CONVEX_SECRET is not set on this deployment');
  }
  if (secret !== expected) {
    throw new ConvexError('Unauthorized');
  }
}
