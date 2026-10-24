import { z } from 'zod';

import { c } from '../contract';
import { type ManualControl, Mode } from '../control';
import { historyPointSchema } from '../snapshot';

const errorSchema = z.object({ message: z.string() });
const deviceParams = z.object({ deviceId: z.string().min(1) });

const manualControlSchema = z
  .object({
    mode: z
      .literal([Mode.Off, Mode.Heat, Mode.Cool, Mode.Auto, Mode.EmergencyHeat])
      .optional(),
    heatSetpointC: z.number().optional(),
    coolSetpointC: z.number().optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Change the mode or a setpoint',
  ) satisfies z.ZodType<ManualControl>;

export const devicesRouter = c.router(
  {
    control: {
      method: 'POST',
      path: '/:deviceId/control',
      description:
        "Set the mode and/or setpoints by hand. Fields left out keep the thermostat's current " +
        "value, read fresh, and nothing is adjusted to fit. Automations aren't paused.",
      pathParams: deviceParams,
      body: manualControlSchema,
      responses: {
        204: c.noBody(),
        400: errorSchema,
        /** Daikin's API failed. */
        502: errorSchema,
      },
    },
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
