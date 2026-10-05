import z from 'zod';
import { c } from '../../contract';

export const clipsV1Router = c.router(
  {
    processClips: {
      path: '/process',
      method: 'POST',
      body: z.object({
        keys: z.string().array().min(1),
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
