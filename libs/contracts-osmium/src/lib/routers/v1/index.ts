import { trackingRouter } from './tracking.router';
import { c } from '../../contract';

export const v1Router = c.router(
  {
    tracking: trackingRouter,
  },
  {
    pathPrefix: '/v1',
  },
);
