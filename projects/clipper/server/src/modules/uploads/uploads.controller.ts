import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { clipperRootRouter } from '@projects/clipper-contracts';
import { UploadsService } from './uploads.service';

const uploadsRouter = clipperRootRouter.v1.uploads;

// TODO: figure out how to guard this.
// Right now it's guarded by only being accessible via tailscale
@Controller()
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @TsRestHandler(uploadsRouter.getSignedUrl)
  public getSignedUrl() {
    return tsRestHandler(uploadsRouter.getSignedUrl, async ({ query }) => {
      return {
        status: 200,
        body: await this.uploadsService.getSignedUploadUrl(query.key),
      };
    });
  }
}
