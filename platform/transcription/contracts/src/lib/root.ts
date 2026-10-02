import { c } from './contract';
import { transcriptionRouter } from './routers/transcription.router';

export const transcriptionRootRouter = c.router(
  {
    transcription: transcriptionRouter,
  },
  {
    pathPrefix: '/api',
    strictStatusCodes: true,
  },
);
