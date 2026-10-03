import z from 'zod';

export type TrackingEvent = z.infer<typeof trackingEventSchema>;
export const trackingEventSchema = z.object({
  timestamp: z.number(),
  name: z.string().min(1),
  source: z.string(),
  properties: z
    .record(
      z.string(),
      z.union([z.string(), z.boolean(), z.number()]).nullable(),
    )
    .optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
