import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { AppModule } from './app/app.module';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter({
    ignoreTrailingSlash: true,
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      rawBody: true,
      logger:
        process.env.DEBUG_LOGGING === 'true'
          ? ['verbose', 'debug', 'log', 'warn', 'error', 'fatal']
          : ['log', 'warn', 'error', 'fatal'],
    },
  );

  const fastifyInstance = app.getHttpAdapter().getInstance();

  // File uploads are streamed straight to disk via `req.raw`, so skip Fastify's
  // body parsing for any content type it doesn't already handle (json/urlencoded)
  // to avoid it buffering/consuming the stream before the handler runs.
  fastifyInstance.addContentTypeParser('*', (_req, _payload, done) => {
    done(null);
  });

  app.enableCors();

  const port = process.env.PORT || 3001;

  await app.listen(port, '0.0.0.0');

  const url = await app.getUrl();
  Logger.log(`🚀 Silver is running on: ${url}`);
}

bootstrap();
