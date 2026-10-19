import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { musicRootRouter } from '@projects/youtube-music-contracts';
import { YtdlpService } from '../media/ytdlp.service';
import { DownloadsService } from './downloads.service';
import { ImportsService } from './imports.service';
import { badRequest, LibraryError } from './library-error';

@Controller()
export class ImportsController {
  constructor(
    private readonly importsService: ImportsService,
    private readonly downloadsService: DownloadsService,
    private readonly ytdlpService: YtdlpService,
  ) {}

  @TsRestHandler({
    import: musicRootRouter.import,
    status: musicRootRouter.status,
  })
  public handler() {
    return tsRestHandler(
      { import: musicRootRouter.import, status: musicRootRouter.status },
      {
        import: async ({ body: { url } }) => {
          try {
            return {
              status: 200,
              body: await this.importsService.import(url),
            };
          } catch (error) {
            if (error instanceof LibraryError) return badRequest(error);
            throw error;
          }
        },
        status: async () => ({
          status: 200,
          body: {
            ytdlpVersion: await this.ytdlpService.version(),
            queue: await this.downloadsService.counts(),
          },
        }),
      },
    );
  }
}
