import { z } from 'zod';
import { c } from '../contract';
import {
  errorSchema,
  playlistNameSchema,
  playlistSchema,
  trackIdsSchema,
} from '../library';

const idParams = z.object({ id: z.coerce.number().int() });

export const playlistsRouter = c.router(
  {
    list: {
      method: 'GET',
      path: '',
      responses: { 200: playlistSchema.array() },
    },
    create: {
      method: 'POST',
      path: '',
      body: playlistNameSchema,
      responses: { 201: playlistSchema },
    },
    rename: {
      method: 'PATCH',
      path: '/:id',
      pathParams: idParams,
      body: playlistNameSchema,
      responses: { 200: playlistSchema, 404: errorSchema },
    },
    remove: {
      method: 'DELETE',
      path: '/:id',
      pathParams: idParams,
      body: c.noBody(),
      description: 'Deletes the playlist. Its tracks stay in the library.',
      responses: { 204: c.noBody(), 404: errorSchema },
    },
    setTracks: {
      method: 'PUT',
      path: '/:id/tracks',
      pathParams: idParams,
      body: trackIdsSchema,
      description:
        'Replaces its tracks with these, in this order. For reordering and removing.',
      responses: { 200: playlistSchema, 400: errorSchema, 404: errorSchema },
    },
    addTracks: {
      method: 'POST',
      path: '/:id/tracks',
      pathParams: idParams,
      body: trackIdsSchema,
      description: 'Adds these to the end, skipping any already in it.',
      responses: { 200: playlistSchema, 400: errorSchema, 404: errorSchema },
    },
    sync: {
      method: 'POST',
      path: '/:id/sync',
      pathParams: idParams,
      body: c.noBody(),
      description:
        'For a playlist imported from YouTube: adds the videos in it on YouTube that this one is missing.',
      responses: {
        200: z.object({ playlist: playlistSchema, queued: z.number() }),
        400: errorSchema,
        404: errorSchema,
      },
    },
  },
  { pathPrefix: '/playlists' },
);
