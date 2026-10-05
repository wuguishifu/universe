import { c } from '../../contract';
import { clipsV1Router } from './clips.v1.router';
import { uploadsV1Router } from './uploads.v1.router';

export const v1Router = c.router(
  {
    clips: clipsV1Router,
    uploads: uploadsV1Router,
  },
  {
    pathPrefix: '/v1',
  },
);
