import { environmentConfig } from '@wuguishifu/environment';
import { sql } from 'drizzle-orm';
import { exit } from 'process';

import { postgresDb } from './pgClient';

if (environmentConfig.environmentKey !== 'development') {
  console.error('You must set `ENVIRONMENT=development` to set up your local DB! 🔴');
  exit(1);
}

const setupTitanDb = async () => {
  console.log('Dropping Titan DB if it exists... 🧹');
  await postgresDb.execute(sql`DROP DATABASE IF EXISTS TITAN WITH (FORCE)`);

  console.log('Creating Titan DB... 🏗');
  await postgresDb.execute(sql`CREATE DATABASE titan`);

  console.log('Done 🏁');
  exit(0);
};

setupTitanDb();
