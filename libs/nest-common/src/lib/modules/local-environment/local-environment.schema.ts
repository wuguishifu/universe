import { z } from 'zod';

/** Fields every app's environment schema starts from. Extend it with `.extend({ ... })`. */
export const baseEnvironmentSchema = z.object({
  debugLogging: z.stringbool().default(false),
  environment: z.enum(['development', 'production']).default('development'),
});

/** Parses "a, b,,c" into ["a", "b", "c"]. */
export const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
