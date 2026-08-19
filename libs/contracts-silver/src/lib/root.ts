import { c } from './contract';
import { converterRouter } from './routers/converter.router';
import { urlRouter } from './routers/url.router';

export const silverRootRouter = c.router(
  {
    converter: converterRouter,
    url: urlRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
