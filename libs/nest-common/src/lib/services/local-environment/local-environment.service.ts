import { Inject, Injectable } from '@nestjs/common';
import z from 'zod';

import { ENVIRONMENT_OPTIONS, ENVIRONMENT_SCHEMA, EnvironmentOptions } from './local-environment.constants';

@Injectable()
export class LocalEnvironmentService<T extends z.ZodType = z.ZodType> {
  private cached: unknown | null = null;

  constructor(
    @Inject(ENVIRONMENT_SCHEMA) private readonly schema: T,
    @Inject(ENVIRONMENT_OPTIONS) private readonly options: EnvironmentOptions,
  ) {}

  public get environment(): z.infer<T> {
    if (this.cached) {
      return this.cached as z.infer<T>;
    }

    const raw = this.rawEnvObject;
    const parsed = this.schema.parse(raw);
    this.cached = parsed;
    return parsed;
  }

  get<K extends keyof z.infer<T>>(key: K): z.infer<T>[K] {
    return this.environment[key];
  }

  private get rawEnvObject(): Record<string, unknown> {
    const prefix = this.options.prefix;
    const env = process.env;

    if (!prefix) {
      return env as unknown as Record<string, unknown>;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith(prefix)) {
        out[k.slice(prefix.length)] = v;
      }
    }
    return out;
  }
}
