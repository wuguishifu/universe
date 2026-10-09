import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';

async function bootstrap() {
  // The HTTP server only serves health checks; work arrives on the stitch-sessions queue from jankbot-gateway.
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

  // On SIGTERM: let an in-flight stitch finish, and kill ffmpeg if it doesn't.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3007;
  await app.listen(port, '0.0.0.0');
  Logger.log(`🎞️ jankbot-stitcher is running on: ${await app.getUrl()}`);
}

bootstrap();
