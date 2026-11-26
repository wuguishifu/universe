import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Plain functions (no Nest) so token-cipher.spec.ts can run them under `node --test`.

const ALGORITHM = 'aes-256-gcm';
/** The prefix of every ciphertext, so the format or key can change later without guessing. */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * What a ciphertext is bound to. Decrypting with a different user or item fails, so a ciphertext
 * copied onto another row in convex is useless.
 */
export const tokenAad = (userId: string, itemId: string): string =>
  `finance-item:${userId}:${itemId}`;

/** `v1:<iv>:<auth tag>:<ciphertext>`, each base64url. A new random IV every call. */
export function encryptToken(
  key: Buffer,
  plaintext: string,
  aad: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) =>
      typeof part === 'string' ? part : part.toString('base64url'),
    )
    .join(':');
}

/** @throws if the payload is malformed, was encrypted with another key or AAD, or was changed. */
export function decryptToken(
  key: Buffer,
  payload: string,
  aad: string,
): string {
  const [version, iv, tag, ciphertext, ...rest] = payload.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext || rest.length) {
    throw new Error('Unrecognized token ciphertext');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, 'base64url'),
    { authTagLength: TAG_BYTES },
  );
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
