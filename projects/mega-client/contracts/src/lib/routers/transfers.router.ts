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
      description: 'Downloads MEGA links into DOWNLOAD_PATH, in order.',
      body: z.object({
        urls: z
          .array(z.string().trim().refine(isMegaLink, 'Not a MEGA link'))
          .min(1, 'No MEGA links'),
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
      description:
        'Pauses the whole queue, which also holds anything queued after it.',
      body: c.noBody(),
      responses,
    },
    resumeAll: {
      method: 'POST',
      path: '/resume-all',
      description:
        'Resumes the queue and every transfer that was paused on its own.',
      body: c.noBody(),
      responses,
    },
    cancelAll: {
      method: 'DELETE',
      path: '',
      description: 'Cancels every download and upload. Syncs are left alone.',
      responses,
    },
  },
  { pathPrefix: '/transfers' },
);
