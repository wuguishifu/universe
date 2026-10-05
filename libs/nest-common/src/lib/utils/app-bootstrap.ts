import { LogLevel, NestApplicationOptions } from '@nestjs/common';
import { IEntryNestModule, NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

export async function createFastifyApp(
  entryModule: IEntryNestModule,
  fastifyAdapter: FastifyAdapter = new FastifyAdapter(),
  options?: NestApplicationOptions,
): Promise<NestFastifyApplication> {
  const loggingTypes = new Set<LogLevel>(['log', 'warn', 'error', 'fatal']);
  if (process.env.DEBUG_LOGGING === 'true') loggingTypes.add('debug');
  if (process.env.VERBOSE === 'true') loggingTypes.add('verbose');

  const app = await NestFactory.create<NestFastifyApplication>(
    entryModule,
    fastifyAdapter,
    {
      logger: Array.from(loggingTypes),
      ...options,
    },
  );

  app.enableShutdownHooks();

  return app;
}
