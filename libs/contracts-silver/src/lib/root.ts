import { initContract } from '@ts-rest/core';

const c = initContract();

export const silverRootRouter = c.router(
  {},
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
