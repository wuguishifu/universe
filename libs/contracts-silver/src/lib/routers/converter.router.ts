import z from 'zod';
import { c } from '../contract';

export const converterRouter = c.router(
  {
    convert: {
      path: '/',
      method: 'POST',
      body: z.object({
        videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
      }),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  { pathPrefix: '/converter' },
);
