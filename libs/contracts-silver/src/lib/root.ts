import { initContract } from '@ts-rest/core';
import { filesRouter } from './routers/files.router';

const c = initContract();

export const silverRootRouter = c.router(
  {
    files: filesRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
