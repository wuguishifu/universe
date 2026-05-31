import { initContract } from '@ts-rest/core';
import z from 'zod';

import { BULL_QUEUE_CONFIG } from '@universe/redis';

const c = initContract();

export const clipperRouter = c.router(
  {
    queue: {
      path: '/queue',
      method: 'POST',
      body: BULL_QUEUE_CONFIG.trimClip.jobSchema,
      responses: {
        200: z.literal('ok'),
      },
    },
    batch: {
      path: '/batch',
      method: 'POST',
      body: BULL_QUEUE_CONFIG.trimClip.jobSchema.array(),
      responses: {
        200: z.literal('ok'),
      },
    },
  },
  {
    pathPrefix: '/clipper',
  },
);
