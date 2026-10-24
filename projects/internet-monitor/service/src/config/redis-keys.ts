import { z } from 'zod';
import { defineRedisKeys, redisValue } from '@libs/redis-cache';

export const incidentSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const MONITOR_REDIS = defineRedisKeys('internet-monitor', {
  openIncidents: redisValue('open-incidents', incidentSchema, { perId: true }),
});
