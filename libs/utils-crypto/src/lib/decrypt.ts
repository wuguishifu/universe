import { createDecipheriv } from 'crypto';
import { parseCipher } from './cipher';
import { getEncryptionKey } from './get-encryption-key';
import { ALGORITHM, AUTH_TAG_LENGTH_BYTES } from './shared-config';

/**
 * @throws
 */
export function decrypt({
  encryptionKey,
  encryptedPayload,
}: {
  encryptionKey: string;
  encryptedPayload: string;
}): string {
  const key = getEncryptionKey(encryptionKey);

  const payload = parseCipher(encryptedPayload);

  if (payload.alg !== ALGORITHM) {
    throw new Error(`Unsupported encryption algorithm: ${payload.alg}`);
  }

  const iv = Buffer.from(payload.iv, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}
