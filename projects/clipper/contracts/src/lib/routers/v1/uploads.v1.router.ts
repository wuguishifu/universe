import z from 'zod';
import { c } from '../../contract';

export const uploadsV1Router = c.router(
  {
    getSignedUrl: {
      path: '/signed-url',
      method: 'GET',
      query: z.object({
        key: z.string(),
      }),
      responses: {
        200: z.string(),
      },
    },
  },
  { pathPrefix: '/upload' },
);
