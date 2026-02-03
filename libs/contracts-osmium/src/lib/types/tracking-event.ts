import z from 'zod';

export type TrackingEvent = z.infer<typeof trackingEventSchema>;
export const trackingEventSchema = z.object({
  name: z.string().min(1),
});
