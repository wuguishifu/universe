import { buildConnectionString } from '@wuguishifu/nest-common';
import dotenv from 'dotenv';
import path from 'path';
import z from 'zod';

const filename = require.main?.filename;
if (!filename) {
  throw new Error('Could not determine the main module filename.');
}
const rootDir = path.join(path.dirname(filename), '..', '..', '..', '..', '..');
const rootEnvPath = path.join(rootDir, '.env');
dotenv.config({ path: rootEnvPath });

const environmentSchema = z.object({
  HYDROGEN_DATABASE: z.string(),
  HYDROGEN_HOST: z.string(),
  HYDROGEN_PASSWORD: z.string(),
  HYDROGEN_PORT: z.coerce.number(),
  HYDROGEN_USER: z.string(),
});

const parsed = environmentSchema.parse(process.env);
const connectionString = buildConnectionString({
  database: parsed.HYDROGEN_DATABASE,
  host: parsed.HYDROGEN_HOST,
  password: parsed.HYDROGEN_PASSWORD,
  port: parsed.HYDROGEN_PORT,
  user: parsed.HYDROGEN_USER,
});

const isLocalHost = (host?: string) => Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));
const isLocalDb = isLocalHost(parsed.HYDROGEN_HOST);

// Set HYDROGEN_DB_SSL=false when connecting to servers that don't support SSL (e.g. via Tailscale)
const useSsl = process.env['HYDROGEN_DB_SSL'] !== 'false' && process.env['HYDROGEN_DB_SSL'] !== '0';

export { connectionString, parsed, isLocalDb, useSsl };
