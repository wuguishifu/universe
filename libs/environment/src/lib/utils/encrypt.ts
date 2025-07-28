import { exec } from 'child_process';
import { readdirSync } from 'fs';
import { dirname } from 'path';
import { exit } from 'process';
import { promisify } from 'util';

import { getPassphrase } from './getPassphrase';

const gpgPassphrase = getPassphrase();

async function encryptEnv(envFile: string) {
  console.log('Encrypting JSON for environment:', envFile);

  const cmd = promisify(exec);
  const { stdout, stderr } = await cmd(
    `gpg --symmetric --passphrase ${gpgPassphrase} --batch --armor --yes --output src/lib/gpg/${envFile}.gpg src/lib/json/${envFile}`,
  );

  console.log(stdout);
  if (stderr) {
    console.error('ERROR:', stderr);
    exit(1);
  }

  console.log('Encryption complete!');
}

async function encryptAllEnv() {
  const jsonDir = `${dirname(require.main?.filename ?? '')}/../json`;
  const environmentFiles = readdirSync(jsonDir).filter((f) => f.endsWith('.json'));

  for (const envFile of environmentFiles) {
    await encryptEnv(envFile);
  }
}

encryptAllEnv();
