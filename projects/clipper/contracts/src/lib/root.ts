import { c } from './contract';
import { v1Router } from './routers/v1';

export const clipperRootRouter = c.router(
  {
    v1: v1Router,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
