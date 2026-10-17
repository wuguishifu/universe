import { z } from 'zod';
import { c } from '../contract';
import {
  locationSchema,
  settingsSchema,
  updateSettingsSchema,
} from '../settings';

const errorSchema = z.object({ message: z.string() });

export const settingsRouter = c.router(
  {
    get: {
      method: 'GET',
      path: '',
      responses: { 200: settingsSchema },
    },
    update: {
      method: 'PATCH',
      path: '',
      description:
        'Switching location triggers a tick so the new house shows up straight away.',
      body: updateSettingsSchema,
      responses: {
        200: settingsSchema,
        400: errorSchema,
      },
    },
    locations: {
      method: 'GET',
      path: '/locations',
      description: 'Every location on the Daikin account, with its devices.',
      responses: { 200: locationSchema.array() },
    },
  },
  { pathPrefix: '/settings' },
);
