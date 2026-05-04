import { z } from 'zod';
import { preprocessBoolean } from '@universe/utils-parse';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  debugLogging: z.preprocess(preprocessBoolean, z.boolean()).default(false),
  environment: z.enum(['development', 'production']),
  convexSiteUrl: z.string(),
  convexUrl: z.string(),
});
