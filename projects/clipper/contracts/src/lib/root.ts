import { c } from './contract';
import { clipsRouter } from './routers/clips.router';
import { runsRouter } from './routers/runs.router';

export const clipperRootRouter = c.router(
  {
    runs: runsRouter,
    clips: clipsRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
