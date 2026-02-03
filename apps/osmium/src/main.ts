import 'dotenv/config';

import multipart from '@fastify/multipart';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { appDevLogger } from '@wuguishifu/nest-common';

import { AppModule } from './app.module';

async function bootstrap() {
  const fastifyAdapter = new FastifyAdapter({ ignoreTrailingSlash: true, trustProxy: true });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastifyAdapter, { rawBody: true });

  app
    .getHttpAdapter()
    .getInstance()
    .register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.enableCors();

  if (process.env.NODE_ENV === 'development') {
    app.use(appDevLogger);
  }

  const port = process.env.PORT || 3001;

  await app.listen(port, '0.0.0.0');

  const url = await app.getUrl();
  Logger.log(`🚀 Osmium is running on: ${url}`);
}

bootstrap();
