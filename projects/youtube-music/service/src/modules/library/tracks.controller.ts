import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { musicRootRouter } from '@projects/youtube-music-contracts';
import { DownloadsService } from './downloads.service';
import { StorageService } from './storage.service';
import { toTrack, TracksService } from './tracks.service';

const notFound = (id: number) =>
  ({ status: 404, body: { message: `No track ${id}` } }) as const;

@Controller()
export class TracksController {
  constructor(
    private readonly tracksService: TracksService,
    private readonly downloadsService: DownloadsService,
    private readonly storageService: StorageService,
  ) {}

  @TsRestHandler(musicRootRouter.tracks)
  public handler() {
    return tsRestHandler(musicRootRouter.tracks, {
      list: async () => ({
        status: 200,
        body: await this.tracksService.list(),
      }),
      update: async ({ params: { id }, body }) => {
        const track = await this.tracksService.update(id, body);
        return track ? { status: 200, body: track } : notFound(id);
      },
      remove: async ({ params: { id } }) => {
        const row = await this.tracksService.remove(id);
        if (!row) return notFound(id);
        await this.downloadsService.cancel(id);
        await this.storageService.delete([row.audioKey, row.artworkKey]);
        return { status: 204, body: undefined };
      },
      retry: async ({ params: { id } }) => {
        const row = await this.tracksService.find(id);
        if (!row) return notFound(id);
        if (row.status !== 'failed') {
          return {
            status: 400,
            body: { message: `Track ${id} hasn't failed (it's ${row.status})` },
          };
        }
        const requeued = await this.tracksService.requeue(id);
        if (!requeued) return notFound(id);
        await this.downloadsService.enqueue(id);
        return { status: 200, body: toTrack(requeued) };
      },
    });
  }
}
