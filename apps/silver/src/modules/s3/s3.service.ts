import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import { EnvironmentService } from '../../environment/environment-service';

@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;

  constructor(private readonly environmentService: EnvironmentService) {
    this.s3Client = new S3Client({
      region: this.environmentService.environment.s3Region,
      endpoint: this.environmentService.environment.s3Endpoint,
      credentials: {
        accessKeyId: this.environmentService.environment.s3AccessKeyId,
        secretAccessKey: this.environmentService.environment.s3SecretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  public putObject({
    key,
    data,
    contentType,
  }: {
    key: string;
    data: string | Uint8Array | Buffer | Readable;
    contentType: string;
  }): Promise<PutObjectCommandOutput> {
    return this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.environmentService.environment.s3Bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  public getSignedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: this.environmentService.environment.s3Bucket,
        Key: key,
      }),
      { expiresIn: 60 * 15 },
    );
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.environmentService.environment.s3Bucket,
          Key: key,
        }),
      );

      return true;
    } catch (error) {
      return false;
    }
  }
}
