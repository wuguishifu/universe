import { z } from 'zod';

/**
 * Feed tickets let a browser open ruby's feed socket without holding a long-lived secret.
 * Sapphire's server signs one for the signed-in Discord user; ruby verifies it on connect.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256 of the first part)>`.
 * Uses Web Crypto so it runs unchanged in Node, Next.js, and Convex.
 */

const ticketPayloadSchema = z.object({
  /** Discord user ID of the viewer. */
  sub: z.string().regex(/^\d+$/),
  /** Expiry, epoch seconds. */
  exp: z.number().int(),
});

export type FeedTicketPayload = z.infer<typeof ticketPayloadSchema>;

/** Only needs to outlive the gap between fetching a ticket and opening the socket. */
const DEFAULT_TTL_SECONDS = 60;

export function signFeedTicket(
  discordUserId: string,
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const payload: FeedTicketPayload = {
    sub: discordUserId,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  return signPayload(payload, secret);
}

/** Returns the payload if the ticket is well-formed, correctly signed, and unexpired. */
export function verifyFeedTicket(
  ticket: string,
  secret: string,
): Promise<FeedTicketPayload | null> {
  return verifyPayload(ticket, secret, ticketPayloadSchema);
}

/**
 * Leaderboard grants let a browser read leaderboards straight from hydrogen. Ruby signs one
 * (with RUBY_CONVEX_SECRET) listing the servers the viewer is a member of; hydrogen's public
 * leaderboard query verifies it.
 */
const grantPayloadSchema = z.object({
  /** Keeps a grant from ever being accepted as something else signed with the same secret. */
  aud: z.literal('leaderboard'),
  sub: z.string().regex(/^\d+$/),
  guildIds: z.array(z.string()),
  exp: z.number().int(),
});

export type LeaderboardGrantPayload = z.infer<typeof grantPayloadSchema>;

export const LEADERBOARD_GRANT_TTL_SECONDS = 10 * 60;

export function signLeaderboardGrant(
  discordUserId: string,
  guildIds: string[],
  secret: string,
): Promise<{ grant: string; expiresAt: number }> {
  const payload: LeaderboardGrantPayload = {
    aud: 'leaderboard',
    sub: discordUserId,
    guildIds,
    exp: Math.floor(Date.now() / 1000) + LEADERBOARD_GRANT_TTL_SECONDS,
  };
  return signPayload(payload, secret).then((grant) => ({
    grant,
    expiresAt: payload.exp * 1000,
  }));
}

export function verifyLeaderboardGrant(
  grant: string,
  secret: string,
): Promise<LeaderboardGrantPayload | null> {
  return verifyPayload(grant, secret, grantPayloadSchema);
}

async function signPayload(payload: object, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importKey(secret),
    encoder.encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifyPayload<T extends { exp: number }>(
  token: string,
  secret: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const [body, signature, ...rest] = token.split('.');
  if (!body || !signature || rest.length > 0) return null;

  try {
    // subtle.verify compares in constant time.
    const valid = await crypto.subtle.verify(
      'HMAC',
      await importKey(secret),
      fromBase64Url(signature),
      encoder.encode(body),
    );
    if (!valid) return null;

    const payload = schema.safeParse(
      JSON.parse(new TextDecoder().decode(fromBase64Url(body))),
    );
    if (!payload.success) return null;
    if (payload.data.exp < Date.now() / 1000) return null;
    return payload.data;
  } catch {
    return null;
  }
}

const encoder = new TextEncoder();

function importKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
