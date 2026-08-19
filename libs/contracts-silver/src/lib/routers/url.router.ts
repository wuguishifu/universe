import z from 'zod';
import { c } from '../contract';

export const urlRouter = c.router(
  {
    getSignedUrl: {
      method: 'GET',
      path: '/signed',
      query: z.object({
        s3Key: z.string(),
      }),
      responses: {
        200: z.url(),
      },
    },
  },
  {
    pathPrefix: '/url',
  },
);
