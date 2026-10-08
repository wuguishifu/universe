import z from 'zod';
import { c } from '../../contract';
import { clipJobDataSchema } from '../../types';

export const clipsV1Router = c.router(
  {
    processClips: {
      path: '/process',
      method: 'POST',
      body: clipJobDataSchema.array(),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  {
    pathPrefix: '/clips',
  },
);
