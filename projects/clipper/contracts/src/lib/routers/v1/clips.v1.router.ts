import z from 'zod';
import { c } from '../../contract';

export const clipsV1Router = c.router(
  {
    processClip: {
      path: '/process',
      method: 'POST',
      body: z.object({
        key: z.string(),
      }),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  {
    pathPrefix: '/clips',
  },
);
