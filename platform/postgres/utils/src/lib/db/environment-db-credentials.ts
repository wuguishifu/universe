import dotenv from 'dotenv';
import z from 'zod';

import path from 'path';

// Resolve relative to this file (not the entry script) so every entry point finds the project root
const projectDir = path.join(import.meta.dirname, '..', '..', '..');
dotenv.config({ path: path.join(projectDir, '.env.local') });

const environmentSchema = z.object({
  UNIVERSE_DB_CONNECTION_STRING: z.string(),
});

const parsed = environmentSchema.parse(process.env);
const connectionString = parsed.UNIVERSE_DB_CONNECTION_STRING;

const isLocalHost = (host?: string) =>
  Boolean(host?.includes('localhost') || host?.includes('127.0.0.1'));
const isLocalDb = isLocalHost(parsed.UNIVERSE_DB_CONNECTION_STRING);

// Set UNIVERSE_DB_SSL=false when connecting to servers that don't support SSL (e.g. via Tailscale)
const useSsl =
  process.env['UNIVERSE_DB_SSL'] !== 'false' &&
  process.env['UNIVERSE_DB_SSL'] !== '0';

export { connectionString, isLocalDb, parsed, useSsl };
