#!/usr/bin/env node
// Logs in to the throwaway vault account and writes its responses to the test fixtures.
// Needs `.env.local` from `nx setup environment` (Infisical `projects/sapphire/vault`) and a Mac
// on the tailnet. The output holds the account's master password and enough to decrypt its vault,
// so it's gitignored: only `expected.json` is tracked.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });

const serverUrl = (
  process.env.VAULT_TEST_SERVER_URL ?? 'https://vault.wuguishifu.dev'
).replace(/\/+$/, '');
const email = process.env.VAULT_TEST_EMAIL?.trim().toLowerCase();
const masterPassword = process.env.VAULT_TEST_MASTER_PASSWORD;
if (!email || !masterPassword) {
  console.error(
    'VAULT_TEST_EMAIL and VAULT_TEST_MASTER_PASSWORD must be set in .env.local (nx setup environment)',
  );
  process.exit(1);
}

// Fixed, so re-capturing reuses one device entry in Vaultwarden.
const deviceIdentifier = '5a9f3c1e-7b2d-4e8a-9c6f-0d1e2f3a4b5c';
const outDir = path.join(root, 'tests/SapphireVaultCoreTests/Fixtures');

async function request(method, url, init) {
  // Same as VaultApi.clientVersion: without it, the sync leaves out SSH keys.
  const headers = { 'Bitwarden-Client-Version': '2024.12.0', ...init.headers };
  const response = await fetch(url, { method, ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${url}: ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

const prelogin = await request(
  'POST',
  `${serverUrl}/identity/accounts/prelogin`,
  {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  },
);
if (prelogin.kdf !== 0) {
  throw new Error(`expected PBKDF2 (kdf 0), got ${prelogin.kdf}`);
}

const masterKey = crypto.pbkdf2Sync(
  masterPassword,
  email,
  prelogin.kdfIterations,
  32,
  'sha256',
);
const masterPasswordHash = crypto
  .pbkdf2Sync(masterKey, masterPassword, 1, 32, 'sha256')
  .toString('base64');

const token = await request('POST', `${serverUrl}/identity/connect/token`, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    username: email,
    password: masterPasswordHash,
    scope: 'api offline_access',
    client_id: 'mobile',
    deviceType: '1',
    deviceIdentifier,
    deviceName: 'sapphire-vault fixtures',
  }),
});

const sync = await request('GET', `${serverUrl}/api/sync?excludeDomains=true`, {
  headers: { Authorization: `Bearer ${token.access_token}` },
});

// Tokens are live credentials for the account; the tests don't need them.
const tokenFixture = { ...token };
delete tokenFixture.access_token;
delete tokenFixture.refresh_token;

const write = (name, value) =>
  fs.writeFileSync(
    path.join(outDir, name),
    typeof value === 'string'
      ? `${value}\n`
      : `${JSON.stringify(value, null, 2)}\n`,
  );
write('account.json', { email, masterPassword });
write('prelogin.json', prelogin);
write('token.json', tokenFixture);
write('sync.json', sync);
write('master-password-hash.txt', masterPasswordHash);

console.log(
  `captured ${sync.ciphers.length} ciphers for ${email} into ${path.relative(process.cwd(), outDir)}`,
);
