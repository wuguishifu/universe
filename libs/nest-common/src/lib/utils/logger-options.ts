import { LogLevel, NestApplicationOptions } from '@nestjs/common';

export function withLoggerOptions(
  options?: NestApplicationOptions,
): NestApplicationOptions {
  return {
    ...options,
    logger: readLogLevel(),
  };
}

function readLogLevel(): LogLevel[] {
  return process.env.DEBUG_LOGGING === 'true'
    ? ['verbose', 'debug', 'log', 'warn', 'error', 'fatal']
    : ['log', 'warn', 'error', 'fatal'];
}
