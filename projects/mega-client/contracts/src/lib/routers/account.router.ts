import { z } from 'zod';
import { c } from '../contract';
import { errorSchema, snapshotSchema } from '../snapshot';

const responses = { 200: snapshotSchema, 400: errorSchema };

export const accountRouter = c.router(
  {
    login: {
      method: 'POST',
      path: '/login',
      body: z.object({
        email: z.email(),
        password: z.string().min(1),
        /** The 6-digit code, for accounts with two-factor authentication. */
        authCode: z
          .string()
          .regex(/^\d{6}$/, 'The code is 6 digits')
          .optional(),
      }),
      responses,
    },
    logout: {
      method: 'POST',
      path: '/logout',
      body: c.noBody(),
      responses,
    },
  },
  { pathPrefix: '/account' },
);
