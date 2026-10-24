import { z } from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema.extend({
  apiToken: z.string().min(1),
  universeDbConnectionString: z.string().min(1),
});

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
