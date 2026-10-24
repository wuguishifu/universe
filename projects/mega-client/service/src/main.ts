import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { existsSync } from 'node:fs';

import { withLoggerOptions } from '@libs/nest-common';

import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    withLoggerOptions(),
  );

  // the SPA is a single page, so serving index.html at / is enough: no fallback route needed.
  const webRoot = process.env.WEB_ROOT;
  if (webRoot) {
    if (!existsSync(webRoot)) {
      throw new Error(`WEB_ROOT ${webRoot} doesn't exist`);
    }
    app.useStaticAssets({ root: webRoot, prefix: '/' });
  }

  app.enableShutdownHooks();

  const port = process.env.PORT || 3010;
  await app.listen(port, '0.0.0.0');
  Logger.log(`☁️ mega-client-service is running on: ${await app.getUrl()}`);
}

bootstrap();
