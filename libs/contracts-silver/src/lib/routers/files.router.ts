import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const filesRouter = c.router(
  {
    getSignedUrl: {
      path: '/signed-url',
      method: 'GET',
      query: z.object({
        fileName: z.string(),
      }),
      responses: {
        200: z.object({
          url: z.string(),
          expiresAt: z.number(),
        }),
      },
    },
    upload: {
      path: '/upload',
      method: 'PUT',
      // the body is a node streamable
      body: c.noBody(),
      query: z.object({
        signature: z.string(),
      }),
      responses: {
        200: z.object({
          message: z.literal('ok'),
        }),
      },
    },
  },
  {
    pathPrefix: '/files',
  },
);
