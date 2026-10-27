import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A random, URL-safe secret: codes, tokens, client secrets, states. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** What a secret is stored and compared as. Also PKCE's S256 transform. */
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
