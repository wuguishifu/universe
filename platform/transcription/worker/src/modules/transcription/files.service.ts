import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';

import { writeFile } from 'fs/promises';

import { S3ObjectNotFoundError, S3Service } from '@libs/nest-common';
import { AudioSource } from '@platform/transcription-contracts';

@Injectable()
export class FilesService {
  constructor(private readonly s3: S3Service) {}

  public async downloadJobFile(source: AudioSource, dest: string) {
    if (source.type === 'inline') {
      return await writeFile(dest, Buffer.from(source.data, 'base64'));
    }

    try {
      await this.s3.downloadToFile(source.bucket, source.key, dest);
    } catch (error) {
      if (error instanceof S3ObjectNotFoundError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
