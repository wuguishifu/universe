export function getEncryptionKey(encryptionKey: string): Buffer {
  const key = Buffer.from(encryptionKey, 'base64');
  if (key.length !== 32) throw new Error('Invalid encryption key');
  return key;
}
