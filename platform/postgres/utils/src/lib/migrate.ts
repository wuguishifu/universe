import chalk from 'chalk';

import { exit, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { dirname } from 'path';

import { dbMigrate } from './db/dev-client';

const isCI = process.env.CI === 'true';
const environment = process.env.ENVIRONMENT ?? 'development';
const ENV = environment.toUpperCase();

const processMigrations = () => {
  console.log(`📢 Running migrations on the ${ENV} universe database`);
  const migrationsFolder = `${dirname(process.argv[1] ?? '.')}/migrations`;

  console.log('📁 Starting migration from directory:', migrationsFolder);

  dbMigrate(migrationsFolder)
    .then(() => {
      console.log('Migration complete!');
      exit(0);
    })
    .catch((error) => {
      console.error('Migration failed!', error);
      exit(1);
    });
};

const handleMigrations = async () => {
  if (isCI) {
    processMigrations();
    // Return but do not exit the process - `processMigrations` will handle the exit of the process once migrations are complete
    return;
  }

  if (environment !== 'development') {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
      chalk.red(
        `You are running migrations on ${ENV} universe database. Are you sure you know what you are doing and want to continue? (y/N):`,
      ),
    );
    rl.close();
    if (answer.toLowerCase() !== 'y') {
      exit(0);
    } else {
      processMigrations();
    }
  } else {
    processMigrations();
  }
};

handleMigrations();
