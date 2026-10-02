import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';
import { readRuntime } from './runtime';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter({
    ignoreTrailingSlash: true,
    trustProxy: true,
    // Inline audio is capped at 10MB, which is ~13.4MB once base64-encoded.
    bodyLimit: 16 * 1024 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      logger:
        process.env.DEBUG_LOGGING === 'true'
          ? ['verbose', 'debug', 'log', 'warn', 'error', 'fatal']
          : ['log', 'warn', 'error', 'fatal'],
    },
  );

  // On SIGTERM, let workers finish their current job (BullMQ's worker.close) before exiting.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3002;
  await app.listen(port, '0.0.0.0');

  const { runsApi, runsWorker, workerLanes } = readRuntime();
  const roles = [
    runsApi && 'api',
    runsWorker && `worker (${workerLanes.join(', ')})`,
  ].filter(Boolean);
  Logger.log(
    `🚀 Transcription service is running on: ${await app.getUrl()} as ${roles.join(' + ')}`,
  );
}

bootstrap();
