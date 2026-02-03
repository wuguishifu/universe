import z from 'zod';

export type TrackingEvent = z.infer<typeof trackingEventSchema>;
export const trackingEventSchema = z.object({
  name: z.string().min(1),
  createdAt: z.number(),
  source: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});
