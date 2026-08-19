import z from 'zod';
import { c } from '../contract';

export const converterRouter = c.router(
  {
    convert: {
      path: '/',
      method: 'POST',
      body: z.object({
        url: z.url(),
      }),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  { pathPrefix: '/converter' },
);
