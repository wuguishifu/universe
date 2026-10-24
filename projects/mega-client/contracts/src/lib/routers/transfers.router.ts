import { z } from 'zod';
import { c } from '../contract';
import { isMegaLink } from '../mega-output';
import { errorSchema, snapshotSchema } from '../snapshot';

/** Digits only: a tag goes straight into MEGAcmd's arguments, where "-a" would mean every transfer. */
const tagParams = z.object({
  tag: z.string().regex(/^\d+$/, 'Not a transfer tag'),
});

const responses = { 200: snapshotSchema, 400: errorSchema };

export const transfersRouter = c.router(
  {
    queue: {
      method: 'POST',
      path: '',
      description: 'Downloads a MEGA link into DOWNLOAD_PATH.',
      body: z.object({
        url: z.string().trim().refine(isMegaLink, 'Not a MEGA link'),
      }),
      responses,
    },
    pause: {
      method: 'POST',
      path: '/:tag/pause',
      pathParams: tagParams,
      body: c.noBody(),
      responses,
    },
    resume: {
      method: 'POST',
      path: '/:tag/resume',
      pathParams: tagParams,
      body: c.noBody(),
      responses,
    },
    cancel: {
      method: 'DELETE',
      path: '/:tag',
      pathParams: tagParams,
      responses,
    },
    pauseAll: {
      method: 'POST',
      path: '/pause-all',
      body: c.noBody(),
      responses,
    },
    resumeAll: {
      method: 'POST',
      path: '/resume-all',
      body: c.noBody(),
      responses,
    },
  },
  { pathPrefix: '/transfers' },
);
