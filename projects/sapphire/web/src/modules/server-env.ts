import 'server-only';

/**
 * Reads a server-only env var, for calling when it's needed rather than at import: `next build`
 * imports route modules to collect page data, without these set.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}
