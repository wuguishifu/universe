import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { clipperRootRouter } from '@projects/clipper-contracts';
import { UploadsService } from './uploads.service';

const uploadsV1Router = clipperRootRouter.v1.uploads;

// TODO: figure out how to guard this.
// Right now it's guarded by only being accessible via tailscale
@Controller()
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @TsRestHandler(uploadsV1Router.getSignedUrl)
  public getSignedUrl() {
    return tsRestHandler(uploadsV1Router.getSignedUrl, async ({ query }) => {
      return {
        status: 200,
        body: await this.uploadsService.getSignedUploadUrl(query.key),
      };
    });
  }
}
