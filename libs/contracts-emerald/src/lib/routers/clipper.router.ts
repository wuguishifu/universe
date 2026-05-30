import { initContract } from '@ts-rest/core';
import z from 'zod';

const c = initContract();

export const clipperRouter = c.router(
  {
    queue: {
      path: '/queue',
      method: 'POST',
      body: z.object({
        filePath: z.string(),
      }),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  {
    pathPrefix: '/clipper',
  },
);
