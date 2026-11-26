#!/usr/bin/env node
// Generates Convex Auth's signing keys and sets them on a convex deployment: JWT_PRIVATE_KEY signs
// the JWTs, JWKS is the public half (served at /.well-known/jwks.json, which finance-service checks
// tokens against). This is the key step of `npx @convex-dev/auth`, without the rest of that CLI,
// which would try to rewrite convex/auth.ts, auth.config.ts, http.ts and tsconfig.
//
// Running it again rotates the keys, which signs everyone out.
//
// Usage: node tools/scripts/convex-auth-keys.mjs           (dev deployment)
//        node tools/scripts/convex-auth-keys.mjs --prod    (or any other `convex env` deployment flag)
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const convexAppDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../platform/convex/app',
);
const deploymentArgs = process.argv.slice(2);

const { privateKey, publicKey } = await generateKeyPair('RS256', {
  extractable: true,
});
const values = {
  // Same format as @convex-dev/auth's CLI: the PEM on one line.
  JWT_PRIVATE_KEY: (await exportPKCS8(privateKey))
    .trimEnd()
    .replace(/\n/g, ' '),
  JWKS: JSON.stringify({
    keys: [{ use: 'sig', ...(await exportJWK(publicKey)) }],
  }),
};

// Passed by file rather than as an argument, so the private key isn't in the process list or
// shell history.
const tempDir = mkdtempSync(join(tmpdir(), 'convex-auth-keys-'));
try {
  for (const [name, value] of Object.entries(values)) {
    const file = join(tempDir, name);
    writeFileSync(file, value, { mode: 0o600 });
    const result = spawnSync(
      'npx',
      ['convex', 'env', 'set', name, '--from-file', file, ...deploymentArgs],
      { cwd: convexAppDir, stdio: 'inherit' },
    );
    if (result.status !== 0) {
      console.error(`ERROR: couldn't set ${name}`);
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
