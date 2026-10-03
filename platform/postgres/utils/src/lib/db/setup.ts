import { sql } from 'drizzle-orm';

import { exit } from 'process';

import { postgresDb } from './pg-client';

function isDevelopment() {
  return process.env.ENVIRONMENT === 'development';
}

function requireDevelopment() {
  if (!isDevelopment()) {
    throw new Error(
      'You must set `ENVIRONMENT=development` to set up your local DB! 🔴',
    );
  }
}

async function setupUniverseDb() {
  requireDevelopment();

  console.log('Dropping Universe DB if it exists... 🧹');
  await postgresDb.execute(sql`DROP DATABASE IF EXISTS universe WITH (FORCE)`);

  console.log('Creating Universe DB... 🏗');
  await postgresDb.execute(sql`CREATE DATABASE universe`);

  console.log('Done 🏁');
  exit(0);
}

requireDevelopment();
setupUniverseDb();
