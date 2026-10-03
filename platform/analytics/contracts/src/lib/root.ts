import { c } from './contract';
import { trackingRouter } from './routers/tracking.router';

export const analyticsRootRouter = c.router(
  {
    tracking: trackingRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
