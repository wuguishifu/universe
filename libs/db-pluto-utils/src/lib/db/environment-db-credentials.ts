import dotenv from 'dotenv';
import z from 'zod';

import path from 'path';

import { buildConnectionString } from './build-connection-string';

const filename = require.main?.filename;
if (!filename) {
  throw new Error('Could not determine the main module filename.');
}
const rootDir = path.join(path.dirname(filename), '..', '..', '..', '..', '..');
const rootEnvPath = path.join(rootDir, '.env');
dotenv.config({ path: rootEnvPath });

const environmentSchema = z.object({
  PLUTO_DATABASE: z.string(),
  PLUTO_HOST: z.string(),
  PLUTO_PASSWORD: z.string(),
  PLUTO_PORT: z.coerce.number(),
  PLUTO_USER: z.string(),
});

const parsed = environmentSchema.parse(process.env);
const connectionString = buildConnectionString({
  database: parsed.PLUTO_DATABASE,
  host: parsed.PLUTO_HOST,
  password: parsed.PLUTO_PASSWORD,
  port: parsed.PLUTO_PORT,
  user: parsed.PLUTO_USER,
});

const isLocalHost = (host?: string) =>
  Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));
const isLocalDb = isLocalHost(parsed.PLUTO_HOST);

// Set PLUTO_DB_SSL=false when connecting to servers that don't support SSL (e.g. via Tailscale)
const useSsl =
  process.env['PLUTO_DB_SSL'] !== 'false' &&
  process.env['PLUTO_DB_SSL'] !== '0';

export { connectionString, isLocalDb, parsed, useSsl };
