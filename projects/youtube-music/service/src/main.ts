import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';

async function bootstrap() {
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

  // On SIGTERM: running downloads are killed and their jobs retried by the next worker.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3010;
  await app.listen(port, '0.0.0.0');
  Logger.log(`🎵 youtube-music-service is running on: ${await app.getUrl()}`);
}

bootstrap();
