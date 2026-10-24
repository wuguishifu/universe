import { c } from './contract';
import { notificationsRouter } from './routers/notifications.router';

export const notificationsRootRouter = c.router(
  {
    notifications: notificationsRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
