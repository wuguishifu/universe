import { environmentConfig } from '@wuguishifu/environment';
import { sql } from 'drizzle-orm';
import { exit } from 'process';

import { postgresDb } from './pgClient';

if (environmentConfig.environmentKey !== 'development') {
  console.error('You must set `ENVIRONMENT=development` to set up your local DB! 🔴');
  exit(1);
}

const setupHydrogenDb = async () => {
  console.log('Dropping Hydrogen DB if it exists... 🧹');
  await postgresDb.execute(sql`DROP DATABASE IF EXISTS HYDROGEN WITH (FORCE)`);

  console.log('Creating Hydrogen DB... 🏗');
  await postgresDb.execute(sql`CREATE DATABASE hydrogen`);

  console.log('Done 🏁');
  exit(0);
};

setupHydrogenDb();
