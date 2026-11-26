import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { S3ObjectNotFoundError, S3Service } from '@libs/nest-s3';
import type { FfmpegInput, FfmpegOutput } from '@platform/ffmpeg-contracts';

import { contentTypeFor } from './content-type';

@Injectable()
export class FilesService {
  constructor(private readonly s3: S3Service) {}

  public async download(input: FfmpegInput, dest: string) {
    try {
      await this.s3.downloadToFile(input.bucket, input.key, dest);
    } catch (error) {
      if (error instanceof S3ObjectNotFoundError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  /** One PUT, so up to S3's 5GB single-object limit. */
  public async upload(
    output: FfmpegOutput,
    src: string,
  ): Promise<{ sizeBytes: number; contentType: string }> {
    const { size } = await stat(src);
    const contentType = output.contentType ?? contentTypeFor(output.key);
    await this.s3.putObject({
      bucket: output.bucket,
      key: output.key,
      data: createReadStream(src),
      contentType,
    });
    return { sizeBytes: size, contentType };
  }
}
