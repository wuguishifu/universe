import { initContract } from '@ts-rest/core';

import { trackingRouter } from './routers/tracking.router';

const c = initContract();

export const osmiumRootRouter = c.router(
  {
    tracking: trackingRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
