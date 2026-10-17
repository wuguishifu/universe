import { z } from 'zod';
import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-common';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema.extend({
  daikinApiKey: z.string().min(1),
  daikinIntegratorToken: z.string().min(1),
  /** The Daikin account the integrator token was issued for. */
  email: z.string().min(1),
  /** Point at a stand-in for local testing. */
  daikinBaseUrl: z
    .string()
    .default('https://integrator-api.daikinskyport.com/v1/'),

  tickIntervalMinutes: z.coerce.number().positive().default(3),

  universeDbConnectionString: z.string().min(1),

  analyticsServiceBaseUrl: z.string().min(1),
  analyticsServiceApiToken: z.string().min(1),
});

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
