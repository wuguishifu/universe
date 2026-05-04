import { z } from 'zod';

const serviceConfigSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  interval: z.number().int().positive().default(60),
  method: z.enum(['GET', 'POST', 'HEAD']).default('GET'),
  expectedStatus: z.number().int().default(200),
  timeout: z.number().int().positive().default(5000),
});

export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export const watchConfigSchema = z.object({
  services: z.array(serviceConfigSchema),
});

export type WatchConfig = z.infer<typeof watchConfigSchema>;
