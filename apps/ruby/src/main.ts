import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';

import { AppModule } from './app/app.module';

async function bootstrap() {
  // The HTTP server serves health checks and the live feed socket; the bot itself is driven by
  // the Discord gateway.
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

  app.useWebSocketAdapter(new WsAdapter(app));

  // On SIGTERM: leave voice channels and let in-flight utterance jobs finish.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3003;
  await app.listen(port, '0.0.0.0');
  Logger.log(`💎 Ruby is running on: ${await app.getUrl()}`);
}

bootstrap();
