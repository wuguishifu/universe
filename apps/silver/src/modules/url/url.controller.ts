import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { silverRootRouter } from '@universe/contracts-silver';
import { S3Service } from '@universe/nest-common';
import { EnvironmentService } from '../../environment/environment-service';

@Controller()
export class UrlController {
  constructor(
    private readonly s3Service: S3Service,
    private readonly environmentService: EnvironmentService,
  ) {}

  @TsRestHandler(silverRootRouter.url.getSignedUrl)
  public getSignedUrl() {
    return tsRestHandler(
      silverRootRouter.url.getSignedUrl,
      async ({ query }) => {
        const url = await this.s3Service.getSignedUrl({
          key: query.s3Key,
          bucket: this.environmentService.environment.s3Bucket,
        });
        return { status: 200, body: url };
      },
    );
  }
}
