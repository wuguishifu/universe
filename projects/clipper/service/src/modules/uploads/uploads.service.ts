import { Injectable } from '@nestjs/common';
import { S3Service } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';

@Injectable()
export class UploadsService {
  constructor(
    private readonly s3Service: S3Service,
    private readonly environmentService: EnvironmentService,
  ) {}

  public getSignedUploadUrl(key: string): Promise<string> {
    return this.s3Service.getSignedUploadUrl({
      bucket: this.environmentService.environment.s3DefaultBucket,
      key,
    });
  }
}
