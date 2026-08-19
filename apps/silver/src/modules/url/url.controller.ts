import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { silverRootRouter } from '@universe/contracts-silver';
import { S3Service } from '../s3/s3.service';

@Controller()
export class UrlController {
  constructor(private readonly s3Service: S3Service) {}

  @TsRestHandler(silverRootRouter.url.getSignedUrl)
  public getSignedUrl() {
    return tsRestHandler(
      silverRootRouter.url.getSignedUrl,
      async ({ query }) => {
        const url = await this.s3Service.getSignedUrl({ key: query.s3Key });
        return { status: 200, body: url };
      },
    );
  }
}
