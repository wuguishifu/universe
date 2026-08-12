import { c } from './contract';
import { converterRouter } from './routers/converter.router';

export const silverRootRouter = c.router(
  {
    converter: converterRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
