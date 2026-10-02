import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';

async function bootstrap() {
  // The HTTP server only serves health checks; work arrives on the BullMQ queues from jankbot-gateway.
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

  // On SIGTERM: let in-flight utterance and interaction jobs finish.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3003;
  await app.listen(port, '0.0.0.0');
  Logger.log(`🤖 jankbot-core is running on: ${await app.getUrl()}`);
}

bootstrap();
