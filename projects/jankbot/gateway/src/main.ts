import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';

async function bootstrap() {
  // The HTTP server only serves health checks; the bot itself is driven by the Discord gateway.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      logger:
        process.env.DEBUG_LOGGING === 'true'
          ? ['verbose', 'debug', 'log', 'warn', 'error', 'fatal']
          : ['log', 'warn', 'error', 'fatal'],
    },
  );

  // On SIGTERM: drop voice connections but remember them, so the next start rejoins.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3004;
  await app.listen(port, '0.0.0.0');
  Logger.log(`📡 jankbot-gateway is running on: ${await app.getUrl()}`);
}

bootstrap();
