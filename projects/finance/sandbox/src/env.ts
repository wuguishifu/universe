import { z } from 'zod';

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// written by `nx setup environment` from infisical /projects/finance/common
const envFile = join(PROJECT_ROOT, '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const envSchema = z.object({
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_CLIENT_SECRET: z.string().min(1),
  // the secret in infisical decides which of these works
  PLAID_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PORT: z.coerce.number().int().default(8787),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(
    'ERROR: invalid environment, run `nx setup environment` to write projects/finance/sandbox/.env.local',
  );
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
