import { initContract } from '@ts-rest/core';

import { clipperRouter } from './routers/clipper.router';

const c = initContract();

export const emeraldRootRouter = c.router(
  {
    clipper: clipperRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
