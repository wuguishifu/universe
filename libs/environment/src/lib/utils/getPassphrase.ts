import fs, { existsSync } from 'fs';
import path from 'path';

export function getPassphrase() {
  let gpgPassphrase = process.env.GPG_PASSPHRASE;
  const gpgFile = `${path.dirname(require.main?.filename ?? '')}/../../../.gpg-passphrase`;

  if (!gpgPassphrase && !fs.existsSync(gpgFile)) {
    throw new Error('GPG_PASSPHRASE not set and .gpg-passphrase file not found');
  }

  if (existsSync(gpgFile)) {
    gpgPassphrase = fs.readFileSync(gpgFile, 'utf8').trim();
  }

  return gpgPassphrase;
}
