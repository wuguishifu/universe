import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { musicRootRouter } from '@projects/youtube-music-contracts';
import { ImportsService } from './imports.service';
import { badRequest, LibraryError } from './library-error';
import { PlaylistsService } from './playlists.service';

const notFound = (id: number) =>
  ({ status: 404, body: { message: `No playlist ${id}` } }) as const;

@Controller()
export class PlaylistsController {
  constructor(
    private readonly playlistsService: PlaylistsService,
    private readonly importsService: ImportsService,
  ) {}

  @TsRestHandler(musicRootRouter.playlists)
  public handler() {
    return tsRestHandler(musicRootRouter.playlists, {
      list: async () => ({
        status: 200,
        body: await this.playlistsService.list(),
      }),
      create: async ({ body: { name } }) => ({
        status: 201,
        body: await this.playlistsService.create(name),
      }),
      rename: async ({ params: { id }, body: { name } }) => {
        const playlist = await this.playlistsService.rename(id, name);
        return playlist ? { status: 200, body: playlist } : notFound(id);
      },
      remove: async ({ params: { id } }) =>
        (await this.playlistsService.remove(id))
          ? { status: 204, body: undefined }
          : notFound(id),
      setTracks: async ({ params: { id }, body: { trackIds } }) => {
        try {
          const playlist = await this.playlistsService.setTracks(id, trackIds);
          return playlist ? { status: 200, body: playlist } : notFound(id);
        } catch (error) {
          if (error instanceof LibraryError) return badRequest(error);
          throw error;
        }
      },
      addTracks: async ({ params: { id }, body: { trackIds } }) => {
        try {
          const playlist = await this.playlistsService.addTracks(id, trackIds);
          return playlist ? { status: 200, body: playlist } : notFound(id);
        } catch (error) {
          if (error instanceof LibraryError) return badRequest(error);
          throw error;
        }
      },
      sync: async ({ params: { id } }) => {
        const playlist = await this.playlistsService.get(id);
        if (!playlist) return notFound(id);
        try {
          return {
            status: 200,
            body: await this.importsService.sync(playlist),
          };
        } catch (error) {
          if (error instanceof LibraryError) return badRequest(error);
          throw error;
        }
      },
    });
  }
}
