import {
  DeleteObjectCommand,
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
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { S3_CONFIG, S3Props } from './s3';

export class S3ObjectNotFoundError extends Error {}

/** The requested range starts past the end of the object (HTTP 416). */
export class S3RangeNotSatisfiableError extends Error {}

export type S3ObjectStream = {
  body: Readable;
  /** Of `body`, so of the range when there is one. */
  contentLength: number | undefined;
  /** Set when a range was requested, e.g. `bytes 0-99/1234`. */
  contentRange: string | undefined;
  contentType: string | undefined;
};

@Injectable()
export class S3Service {
  private readonly client: S3Client | null;
  /**
   * For presigned uploads. The SDK otherwise signs a checksum of the (still empty) body into the
   * URL, so the real upload doesn't match it.
   */
  private readonly uploadPresignClient: S3Client | null;

  constructor(@Inject(S3_CONFIG) s3: S3Props | null) {
    const config = s3 && {
      endpoint: s3.endpoint,
      region: s3.region,
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
      forcePathStyle: s3.forcePathStyle,
    };
    this.client = config ? new S3Client(config) : null;
    this.uploadPresignClient = config
      ? new S3Client({ ...config, requestChecksumCalculation: 'WHEN_REQUIRED' })
      : null;
  }

  public get isConfigured() {
    return this.client !== null;
  }

  private get s3Client() {
    if (!this.client) throw new Error('S3 is not configured');
    return this.client;
  }

  public async downloadToFile(bucket: string, key: string, path: string) {
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

  /**
   * Streams an object, or the part of it in `range` (an HTTP Range header value, passed on to S3 as
   * is), so it can be piped into a response without buffering it.
   */
  public async getObjectStream({
    bucket,
    key,
    range,
  }: {
    bucket: string;
    key: string;
    range?: string;
  }): Promise<S3ObjectStream> {
    try {
      const { Body, ContentLength, ContentRange, ContentType } =
        await this.s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
        );
      if (!(Body instanceof Readable))
        throw new Error('Unexpected S3 body type');
      return {
        body: Body,
        contentLength: ContentLength,
        contentRange: ContentRange,
        contentType: ContentType,
      };
    } catch (error) {
      if (error instanceof NoSuchKey) {
        throw new S3ObjectNotFoundError(`s3://${bucket}/${key} does not exist`);
      }
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 416
      ) {
        throw new S3RangeNotSatisfiableError(
          `${range} is outside s3://${bucket}/${key}`,
        );
      }
      throw error;
    }
  }

  /** Deletes an object. Deleting one that doesn't exist does nothing. */
  public async deleteObject({
    bucket,
    key,
  }: {
    bucket: string;
    key: string;
  }): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
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
  }: {
    key: string;
    bucket: string;
  }): Promise<string> {
    return getSignedUrl(
      this.s3Client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${key}"`,
      }),
      { expiresIn: 60 * 15 },
    );
  }

  /**
   * A URL to upload one object with PUT, without credentials. The upload must send this
   * Content-Type and exactly this many bytes.
   */
  public getSignedPutUrl({
    key,
    bucket,
    contentType,
    contentLength,
    expiresInSec,
  }: {
    key: string;
    bucket: string;
    contentType: string;
    contentLength: number;
    expiresInSec: number;
  }): Promise<string> {
    if (!this.uploadPresignClient) throw new Error('S3 is not configured');
    return getSignedUrl(
      this.uploadPresignClient,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: expiresInSec },
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
