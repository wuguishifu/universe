import { z } from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

export type EnvironmentSchema = z.infer<typeof environmentSchema>;
export const environmentSchema = baseEnvironmentSchema.extend({
  apiToken: z.string().min(1),
  redisUrl: z.string().min(1),

  convexUrl: z.string().min(1),
  /** Must match NOTIFICATIONS_CONVEX_SECRET on the convex deployment. */
  notificationsConvexSecret: z.string().min(16),

  /** Expo's enhanced push security rejects sends without it. */
  expoAccessToken: z.string().min(1),
});

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
