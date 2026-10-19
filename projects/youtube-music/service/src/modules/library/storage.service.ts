import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { S3Service } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';

/** Where tracks' files live in S3: tracks/<youtube id>/{audio.m4a,artwork.jpg}. */
@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(
    private readonly s3: S3Service,
    environmentService: EnvironmentService,
  ) {
    this.bucket = environmentService.environment.musicS3Bucket;
  }

  audioKey = (youtubeId: string) => `tracks/${youtubeId}/audio.m4a`;
  artworkKey = (youtubeId: string) => `tracks/${youtubeId}/artwork.jpg`;

  /** Uploads a local file and resolves with its size. Tracks are a few MB, so it's read whole. */
  async upload(key: string, path: string, contentType: string) {
    const data = await readFile(path);
    await this.s3.putObject({ bucket: this.bucket, key, data, contentType });
    return data.length;
  }

  stream(key: string, range?: string) {
    return this.s3.getObjectStream({ bucket: this.bucket, key, range });
  }

  async delete(keys: (string | null)[]) {
    for (const key of keys) {
      if (key) await this.s3.deleteObject({ bucket: this.bucket, key });
    }
  }
}
