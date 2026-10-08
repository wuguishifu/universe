import z from 'zod';
import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-common';

export const environmentSchema = baseEnvironmentSchema.extend({
  analyticsServiceBaseUrl: z.string().min(1),
  analyticsServiceApiToken: z.string().min(1),
});
export type EnvironmentSchema = z.infer<typeof environmentSchema>;

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
