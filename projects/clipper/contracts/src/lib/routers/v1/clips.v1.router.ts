import z from 'zod';
import { c } from '../../contract';
import { preprocessClipJobDataSchema } from '../../types';

export const clipsV1Router = c.router(
  {
    processClips: {
      path: '/process',
      method: 'POST',
      body: preprocessClipJobDataSchema.array(),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  {
    pathPrefix: '/clips',
  },
);
