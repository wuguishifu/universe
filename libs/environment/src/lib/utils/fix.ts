import { exec } from 'child_process';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import _ from 'lodash';
import { dirname } from 'path';
import { promisify } from 'util';

import { getPassphrase } from './getPassphrase';

const FILE_HEADER = '-----BEGIN PGP MESSAGE-----';
const FILE_FOOTER = '-----END PGP MESSAGE-----';

const gpgPassphrase = getPassphrase();
const cmd = promisify(exec);

async function fix(env: string) {
  const headGpgPath = `src/lib/gpg/${env}.head.gpg`;
  const headJsonPath = `src/lib/json/${env}.head.json`;

  const incomingGpgPath = `src/lib/gpg/${env}.incoming.gpg`;
  const incomingJsonPath = `src/lib/json/${env}.incoming.json`;

  const mergedGpgPath = `src/lib/gpg/${env}.json.gpg`;
  const mergedJsonPath = `src/lib/json/${env}.json`;

  const file = readFileSync(mergedGpgPath, 'utf-8');

  if (!file.includes('=======')) {
    throw new Error(`File ${mergedGpgPath} does not contain a merge conflict`);
  }

  const [head, incoming] = file.split('=======');
  if (!head || !incoming) {
    throw new Error(`File ${mergedGpgPath} does not contain a merge conflict`);
  }

  const [, headComponent] = head.split('<<<<<<< HEAD\n');
  const [incomingComponent] = incoming.split('>>>>>>>');

  const headGpg = `${FILE_HEADER}\n\n${headComponent}${FILE_FOOTER}`;
  const incomingGpg = `${FILE_HEADER}\n${incomingComponent}${FILE_FOOTER}`;

  writeFileSync(`src/lib/gpg/${env}.head.gpg`, headGpg);
  writeFileSync(`src/lib/gpg/${env}.incoming.gpg`, incomingGpg);

  const decryptOutputs = await Promise.all([
    cmd(`gpg --decrypt --batch --passphrase ${gpgPassphrase} --yes --output ${headJsonPath} ${headGpgPath}`),
    cmd(`gpg --decrypt --batch --passphrase ${gpgPassphrase} --yes --output ${incomingJsonPath} ${incomingGpgPath}`),
  ]);

  console.log(decryptOutputs[0].stdout);
  console.log(decryptOutputs[0].stderr);
  console.log(decryptOutputs[1].stdout);
  console.log(decryptOutputs[1].stderr);

  unlinkSync(headGpgPath);
  unlinkSync(incomingGpgPath);

  const headJsonFile = readFileSync(headJsonPath, 'utf-8');
  const incomingJsonFile = readFileSync(incomingJsonPath, 'utf-8');

  const headJson = JSON.parse(headJsonFile);
  const incomingJson = JSON.parse(incomingJsonFile);

  const mergedJson = _.merge(headJson, incomingJson);
  const mergedJsonFile = `${JSON.stringify(mergedJson, null, 2)}\n`;

  writeFileSync(mergedJsonPath, mergedJsonFile, 'utf-8');

  unlinkSync(headJsonPath);
  unlinkSync(incomingJsonPath);

  const encryptOutput = await cmd(
    `gpg --symmetric --passphrase ${gpgPassphrase} --batch --armor --yes --output ${mergedGpgPath} ${mergedJsonPath}`,
  );

  console.log(encryptOutput.stdout);
  console.log(encryptOutput.stderr);
}

async function fixAll() {
  const gpgDir = `${dirname(require.main?.filename ?? '')}/../gpg`;
  const environments = readdirSync(gpgDir).map((f) => f.replace('.json.gpg', ''));

  for (const env of environments) {
    try {
      await fix(env);
    } catch (error) {
      console.log(error);
    }
  }
}

fixAll();
