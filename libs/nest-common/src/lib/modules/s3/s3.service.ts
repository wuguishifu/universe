import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  PutObjectCommandOutput,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { S3_CONFIG, S3Props } from './s3';

export class S3ObjectNotFoundError extends Error {}

@Injectable()
export class S3Service {
  private readonly client: S3Client | null;

  constructor(@Inject(S3_CONFIG) s3: S3Props | null) {
    this.client = s3
      ? new S3Client({
          endpoint: s3.endpoint,
          region: s3.region,
          credentials: {
            accessKeyId: s3.accessKeyId,
            secretAccessKey: s3.secretAccessKey,
          },
          forcePathStyle: s3.forcePathStyle,
        })
      : null;
  }

  public get isConfigured() {
    return this.client !== null;
  }

  private get s3Client() {
    if (!this.client) throw new Error('S3 is not configured');
    return this.client;
  }

  public async downloadToFile({
    bucket,
    key,
    path,
  }: {
    bucket: string;
    key: string;
    path: string;
  }) {
    try {
      const { Body } = await this.s3Client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!(Body instanceof Readable))
        throw new Error('Unexpected S3 body type');
      await pipeline(Body, createWriteStream(path));
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new S3ObjectNotFoundError(`s3://${bucket}/${key} does not exist`);
      }
      throw error;
    }
  }

  /**
   * Bytes `start` to `end` (inclusive, like an HTTP Range) of an object, without downloading the
   * rest. Shorter if the object ends first, and empty if it ends before `start`.
   */
  public async getObjectRange({
    bucket,
    key,
    start,
    end,
  }: {
    bucket: string;
    key: string;
    start: number;
    end: number;
  }): Promise<Buffer> {
    try {
      const { Body } = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=${start}-${end}`,
        }),
      );
      if (!Body) return Buffer.alloc(0);
      return Buffer.from(await Body.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new S3ObjectNotFoundError(`s3://${bucket}/${key} does not exist`);
      }
      // 416: the range starts past the end of the object.
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 416
      ) {
        return Buffer.alloc(0);
      }
      throw error;
    }
  }

  public putObject({
    key,
    data,
    contentType,
    bucket,
  }: {
    key: string;
    data: string | Uint8Array | Buffer | Readable;
    contentType: string;
    bucket: string;
  }): Promise<PutObjectCommandOutput> {
    return this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  public getSignedUrl({
    key,
    bucket,
    expiresInS,
  }: {
    key: string;
    bucket: string;
    expiresInS?: number;
  }): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${key}"`,
      }),
      { expiresIn: expiresInS ?? 60 * 15 },
    );
  }

  public getSignedUploadUrl({
    key,
    bucket,
  }: {
    key: string;
    bucket: string;
  }): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
      { expiresIn: 60 * 15 },
    );
  }

  public async exists({
    key,
    bucket,
  }: {
    key: string;
    bucket: string;
  }): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      return true;
    } catch (error) {
      return false;
    }
  }
}
