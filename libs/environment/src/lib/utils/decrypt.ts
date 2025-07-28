import { exec } from 'child_process';
import { readdirSync } from 'fs';
import { dirname } from 'path';
import { promisify } from 'util';

import { getPassphrase } from './getPassphrase';

const gpgPassphrase = getPassphrase();

async function decryptEnv(env: string) {
  console.log('Setting up environment:', env);
  const cmd = promisify(exec);
  const { stdout, stderr } = await cmd(
    `gpg --decrypt --batch --passphrase ${gpgPassphrase} --yes --output src/lib/json/${env}.json src/lib/gpg/${env}.json.gpg`,
  );

  console.log(stdout);
  console.log(stderr);

  console.log('Environment decrypted successfully');
}

async function decryptAll() {
  const jsonDir = `${dirname(require.main?.filename ?? '')}/../gpg`;
  const environments = readdirSync(jsonDir).map((f) => f.replace('.json.gpg', ''));

  for (const env of environments) {
    await decryptEnv(env);
  }
}

decryptAll();
