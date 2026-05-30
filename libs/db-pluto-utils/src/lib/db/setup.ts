import { sql } from 'drizzle-orm';

import { exit } from 'process';

import { postgresDb } from './pg-client';

if (process.env.ENVIRONMENT !== 'development') {
  console.error(
    'You must set `ENVIRONMENT=development` to set up your local DB! 🔴',
  );
  exit(1);
}

const setupPlutoDb = async () => {
  console.log('Dropping Pluto DB if it exists... 🧹');
  await postgresDb.execute(sql`DROP DATABASE IF EXISTS pluto WITH (FORCE)`);

  console.log('Creating Pluto DB... 🏗');
  await postgresDb.execute(sql`CREATE DATABASE pluto`);

  console.log('Done 🏁');
  exit(0);
};

setupPlutoDb();
