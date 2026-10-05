import { Injectable } from '@nestjs/common';
import { z } from 'zod';

export type EnvironmentOptions = {
  /**
   * Optional prefix for env variables, e.g. "API_".
   * If set, process.env.API_FOO is read into schema key "FOO".
   */
  prefix?: string;
  /**
   * Converts SNAKE_CASE keys to camelCase before parsing. Defaults to true.
   */
  camelize?: boolean;
};

/**
 * Parses process.env against a schema. Use this directly for anything that has to read the
 * environment before DI is set up; everything else should inject the app's EnvironmentService.
 */
export function readEnvironment<T extends z.ZodType>(
  schema: T,
  { prefix, camelize = true }: EnvironmentOptions = {},
): z.infer<T> {
  let env: Record<string, unknown> = process.env;

  if (prefix) {
    env = Object.fromEntries(
      Object.entries(env)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
  }

  if (camelize) {
    env = Object.fromEntries(
      Object.entries(env)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [snakeToCamel(key), value]),
    );
  }

  return schema.parse(env);
}

/**
 * Builds an injectable service exposing the parsed environment. The environment is parsed when
 * the service is constructed, so a bad config fails the app at startup.
 *
 * @example
 * export class EnvironmentService extends createEnvironmentService(environmentSchema) {}
 * export const EnvironmentModule = LocalEnvironmentModule.forRoot(EnvironmentService);
 */
export function createEnvironmentService<T extends z.ZodType>(
  schema: T,
  options?: EnvironmentOptions,
) {
  @Injectable()
  class LocalEnvironmentService {
    public readonly environment: z.infer<T> = readEnvironment(schema, options);
  }

  return LocalEnvironmentService;
}

function snakeToCamel(s: string): string {
  return s
    .toLowerCase()
    .replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
