import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

import { config } from './definition';

let env;
try {
  const rootEnvPath = path.resolve(path.join(__dirname, '..', '..', '..', '..', '.env'));
  env = dotenv.config({
    path: rootEnvPath,
  });
} catch {
  // `path` will fail when it's used from within NextJS middleware. NextJS middleware
  // will access the environment variables directly from `process.env`.
}

const environment = process.env.ENVIRONMENT || env?.parsed?.ENVIRONMENT || 'development';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const envJson = require(`./json/${environment}.json`);

const result = config.safeParse(envJson);

if (!result.success) {
  throw new Error(`Invalid environment configuration in ${environment}.json: ${result.error.message}`);
}

export const environmentConfig = result.data;
export type EnvironmentConfig = z.infer<typeof config>;
