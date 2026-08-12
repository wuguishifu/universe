import { z } from 'zod';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  debugLogging: z.stringbool().default(false),
  environment: z.enum(['development', 'production']),
  convexAdminToken: z.string(),
  convexSiteUrl: z.string(),
  convexUrl: z.string(),
  configPath: z.string().default('/config/services.yaml'),
});
