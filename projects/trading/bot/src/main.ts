import 'dotenv/config';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';

async function bootstrap() {
  const logger = new ConsoleLogger({
    json: process.env.LOG_JSON !== 'false',
    logLevels:
      process.env.DEBUG_LOGGING === 'true'
        ? ['verbose', 'debug', 'log', 'warn', 'error', 'fatal']
        : ['log', 'warn', 'error', 'fatal'],
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger },
  );

  // SIGTERM/SIGINT run onModuleDestroy, which flattens before the process exits.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3013;
  await app.listen(port, '0.0.0.0');
  Logger.log(`📈 trading-bot is running on: ${await app.getUrl()}`);
}

bootstrap();
