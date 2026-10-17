import { c } from './contract';
import { automationsRouter } from './routers/automations.router';
import { devicesRouter } from './routers/devices.router';
import { settingsRouter } from './routers/settings.router';
import { snapshotSchema, tickStatusSchema } from './snapshot';

export const thermoRootRouter = c.router(
  {
    settings: settingsRouter,
    automations: automationsRouter,
    devices: devicesRouter,
    snapshot: {
      method: 'GET',
      path: '/snapshot',
      description: 'What /stream sends, for one-off reads.',
      responses: { 200: snapshotSchema },
    },
    status: {
      method: 'GET',
      path: '/status',
      responses: { 200: tickStatusSchema },
    },
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
