import z from 'zod';

import { c } from '../../contract';
import { trackingEventSchema } from '../../types/tracking-event';

export const trackingRouter = c.router(
  {
    trackEvent: {
      method: 'POST',
      path: '/events',
      description: 'Track an analytics event',
      body: trackingEventSchema,
      responses: {
        200: z.object({
          status: z.literal('ok'),
        }),
      },
    },
    trackEventBatch: {
      method: 'POST',
      path: '/events/batch',
      description: 'Track a batch of analytics events',
      body: z.array(trackingEventSchema),
      responses: {
        200: z.object({
          status: z.literal('ok'),
        }),
      },
    },
  },
  {
    pathPrefix: '/tracking',
  },
);
