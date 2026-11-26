import 'dotenv/config';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';

import { withLoggerOptions } from '@libs/nest-core';

import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    withLoggerOptions(),
  );

  app.enableShutdownHooks();

  const port = process.env.PORT || 3013;
  await app.listen(port, '0.0.0.0');
  Logger.log(`💸 finance-service is running on: ${await app.getUrl()}`);
}

bootstrap();
