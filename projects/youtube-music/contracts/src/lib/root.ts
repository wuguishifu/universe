import { c } from './contract';
import {
  errorSchema,
  importInputSchema,
  importResultSchema,
  serverStatusSchema,
} from './library';
import { playlistsRouter } from './routers/playlists.router';
import { tracksRouter } from './routers/tracks.router';

export const API_PREFIX = '/api';

/** Every route but /api/health needs `Authorization: Bearer <API_TOKEN>`. */
export const musicRootRouter = c.router(
  {
    tracks: tracksRouter,
    playlists: playlistsRouter,
    import: {
      method: 'POST',
      path: '/imports',
      body: importInputSchema,
      description:
        'Adds a video to the library, or a playlist as a new playlist, and queues the downloads.',
      responses: { 200: importResultSchema, 400: errorSchema },
    },
    status: {
      method: 'GET',
      path: '/status',
      responses: { 200: serverStatusSchema },
    },
  },
  {
    pathPrefix: API_PREFIX,
    strictStatusCodes: true,
  },
);

/**
 * The track's audio (AAC in an MP4 container), with Range support. Like the artwork, it also
 * accepts the token as `?token=`, for players that can't send headers.
 */
export const trackAudioPath = (id: number) =>
  `${API_PREFIX}/tracks/${id}/audio`;

/** A square JPEG. 404 if the video had no thumbnail. */
export const trackArtworkPath = (id: number) =>
  `${API_PREFIX}/tracks/${id}/artwork`;
