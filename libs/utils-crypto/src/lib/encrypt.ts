import { createCipheriv, randomBytes } from 'crypto';
import { createCipher } from './cipher';
import { getEncryptionKey } from './get-encryption-key';
import {
  ALGORITHM,
  AUTH_TAG_LENGTH_BYTES,
  IV_LENGTH_BYTES,
} from './shared-config';

export function encrypt({
  encryptionKey,
  data,
}: {
  encryptionKey: string;
  data: unknown;
}): string {
  const key = getEncryptionKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return createCipher({
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}
