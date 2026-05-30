import { z } from 'zod';

import { preprocessBoolean } from '@universe/utils-parse';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = z.object({
  environment: z.enum(['development', 'production']).default('development'),
  debugLogging: z.preprocess(preprocessBoolean, z.boolean()).default(false),
  osmiumAdminToken: z.string(),
});
