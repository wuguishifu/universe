import { z } from 'zod';

/** Fields every app's environment schema starts from. Extend it with `.extend({ ... })`. */
export const baseEnvironmentSchema = z.object({
  debugLogging: z.stringbool().default(false),
  environment: z.enum(['development', 'production']).default('development'),
  // Baked into the image by CI, e.g. "1.2.3" and "analytics-service-v1.2.3". Local docker builds
  // set them to "", so fall back on anything empty rather than only when missing.
  version: z.string().min(1).catch('unknown'),
  versionTag: z.string().min(1).catch('unknown'),
});

/** Parses "a, b,,c" into ["a", "b", "c"]. */
export const commaSeparated = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);
