import { z } from 'zod';
import { c } from '../contract';
import { errorSchema, trackSchema, trackUpdateSchema } from '../library';

const idParams = z.object({ id: z.coerce.number().int() });

/**
 * The library. The audio and artwork aren't part of the contract since they're streamed: see
 * `trackAudioPath` and `trackArtworkPath`.
 */
export const tracksRouter = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      description: 'Every track, newest first.',
      responses: { 200: trackSchema.array() },
    },
    update: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      body: trackUpdateSchema,
      responses: { 200: trackSchema, 404: errorSchema },
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      body: c.noBody(),
      description: 'Deletes it from the library, its playlists and S3.',
      responses: { 204: c.noBody(), 404: errorSchema },
    },
    retry: {
      method: 'POST',
      path: '/:id/retry',
      pathParams: idParams,
      body: c.noBody(),
      description: 'Queues a failed download again.',
      responses: { 200: trackSchema, 400: errorSchema, 404: errorSchema },
    },
  },
  { pathPrefix: '/tracks' },
);
