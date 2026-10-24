import { Injectable } from '@nestjs/common';

import { S3Service } from '@libs/nest-s3';
import { createProxyS3Key, PROXY } from '@projects/clipper-contracts';

import { EnvironmentService } from '../../config/environment';

/** Long enough to upload a backlog's worth of URLs from one request, one after another. */
const UPLOAD_URL_TTL_SEC = 60 * 60;
/** HEADs at once while checking which proxies are already uploaded. */
const CHECK_CONCURRENCY = 16;

@Injectable()
export class ClipsService {
  constructor(
    private readonly s3: S3Service,
    private readonly environmentService: EnvironmentService,
  ) {}

  async uploadUrls(clips: { sha256: string; sizeBytes: number }[]) {
    const bucket = this.environmentService.environment.clipperS3Bucket;
    const uploads: { sha256: string; key: string; uploadUrl?: string }[] = [];
    for (let i = 0; i < clips.length; i += CHECK_CONCURRENCY) {
      const batch = clips.slice(i, i + CHECK_CONCURRENCY);
      uploads.push(
        ...(await Promise.all(
          batch.map(async ({ sha256, sizeBytes }) => {
            const key = createProxyS3Key(sha256);
            if (await this.s3.exists({ bucket, key })) return { sha256, key };
            const uploadUrl = await this.s3.getSignedPutUrl({
              bucket,
              key,
              contentType: PROXY.contentType,
              contentLength: sizeBytes,
              expiresInSec: UPLOAD_URL_TTL_SEC,
            });
            return { sha256, key, uploadUrl };
          }),
        )),
      );
    }
    return { bucket, uploads, expiresInSec: UPLOAD_URL_TTL_SEC };
  }
}
