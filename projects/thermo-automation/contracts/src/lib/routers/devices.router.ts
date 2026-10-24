import { z } from 'zod';

import { c } from '../contract';
import { historyPointSchema } from '../snapshot';

const errorSchema = z.object({ message: z.string() });
const deviceParams = z.object({ deviceId: z.string().min(1) });

export const devicesRouter = c.router(
  {
    pause: {
      method: 'POST',
      path: '/:deviceId/pause',
      description:
        'Leave the device alone until `until`. Readings are still recorded.',
      pathParams: deviceParams,
      body: z.object({ until: z.iso.datetime() }),
      responses: {
        200: z.object({ pausedUntil: z.iso.datetime() }),
        400: errorSchema,
      },
    },
    resume: {
      method: 'POST',
      path: '/:deviceId/resume',
      pathParams: deviceParams,
      body: c.noBody(),
      responses: { 204: c.noBody() },
    },
    history: {
      method: 'GET',
      path: '/:deviceId/history',
      description:
        "The device's recorded readings at the selected location, oldest first.",
      pathParams: deviceParams,
      query: z.object({
        hours: z.coerce
          .number()
          .min(1)
          .max(24 * 7)
          .default(24),
      }),
      responses: { 200: historyPointSchema.array() },
    },
  },
  { pathPrefix: '/devices' },
);
