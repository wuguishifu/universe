import dotenv from 'dotenv';
import z from 'zod';

import path from 'path';

const rootDir = path.join(
  path.dirname(process.argv[1] ?? '.'),
  '..',
  '..',
  '..',
  '..',
  '..',
);
const rootEnvPath = path.join(rootDir, '.env');
dotenv.config({ path: rootEnvPath });

const environmentSchema = z.object({
  PLUTO_DB_CONNECTION_STRING: z.string(),
});

const parsed = environmentSchema.parse(process.env);
const connectionString = parsed.PLUTO_DB_CONNECTION_STRING;

const isLocalHost = (host?: string) =>
  Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));
const isLocalDb = isLocalHost(parsed.PLUTO_DB_CONNECTION_STRING);

// Set PLUTO_DB_SSL=false when connecting to servers that don't support SSL (e.g. via Tailscale)
const useSsl =
  process.env['PLUTO_DB_SSL'] !== 'false' &&
  process.env['PLUTO_DB_SSL'] !== '0';

export { connectionString, isLocalDb, parsed, useSsl };
