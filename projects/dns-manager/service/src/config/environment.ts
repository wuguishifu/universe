import z from 'zod';

import {
  baseEnvironmentSchema,
  createEnvironmentService,
  LocalEnvironmentModule,
} from '@libs/nest-core';

export const environmentSchema = baseEnvironmentSchema.extend({
  traefikApiUrl: z.url(),
  traefikApiUsername: z.string().min(1).optional(),
  traefikApiPassword: z.string().min(1).optional(),
  domain: z.string().min(1).default('wuguishifu.dev'),
  tailnetTarget: z.string().min(1),
  gatewaySuffix: z.string().min(1).default('-gw'),
  gatewayTarget: z.string().min(1).optional(),
  syncIntervalSeconds: z.coerce.number().int().positive().default(60),
  removalGraceSeconds: z.coerce.number().int().nonnegative().default(300),
  dnsEndpointNamespace: z.string().min(1).default('external-dns'),
  dnsEndpointName: z.string().min(1).default('nas-routes'),
  // Unset in a pod: the in-cluster API server and service account are used.
  kubeApiUrl: z.url().optional(),
  dryRun: z.stringbool().default(false),
});
export type EnvironmentSchema = z.infer<typeof environmentSchema>;

export class EnvironmentService extends createEnvironmentService(
  environmentSchema,
) {}

export const EnvironmentModule =
  LocalEnvironmentModule.forRoot(EnvironmentService);
