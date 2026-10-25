import z from 'zod';

import { c } from '../contract';
import {
  idempotencyKeySchema,
  notificationJobSchema,
} from '../types/notification';

export const notificationsRouter = c.router(
  {
    send: {
      method: 'POST',
      path: '',
      description:
        'Queue a notification for every device subscribed to its channel',
      body: notificationJobSchema.extend({
        idempotencyKey: idempotencyKeySchema.optional(),
      }),
      responses: {
        202: z.object({
          jobId: z.string(),
        }),
      },
    },
  },
  {
    pathPrefix: '/notifications',
  },
);
