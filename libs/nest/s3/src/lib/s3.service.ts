import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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

export type ListedS3Object = {
  key: string;
  /** As S3 sends it, quotes included. */
  etag: string;
  sizeBytes: number;
  lastModified?: Date;
};

/** DeleteObjects' limit per request. */
const MAX_DELETE_KEYS = 1000;

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

  /** Every object under `prefix` (or the whole bucket), a page of up to 1000 at a time. */
  public async *listObjects({
    bucket,
    prefix,
  }: {
    bucket: string;
    prefix?: string;
  }): AsyncGenerator<ListedS3Object[]> {
    let continuationToken: string | undefined;
    do {
      const page = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects: ListedS3Object[] = [];
      for (const object of page.Contents ?? []) {
        if (object.Key === undefined) continue;
        objects.push({
          key: object.Key,
          etag: object.ETag ?? '',
          sizeBytes: object.Size ?? 0,
          lastModified: object.LastModified,
        });
      }
      if (objects.length > 0) yield objects;
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  /**
   * Deletes `keys` (ones that don't exist are fine), 1000 per request.
   *
   * @throws if S3 couldn't delete some of them.
   */
  public async deleteObjects({
    bucket,
    keys,
  }: {
    bucket: string;
    keys: string[];
  }): Promise<void> {
    for (let i = 0; i < keys.length; i += MAX_DELETE_KEYS) {
      const chunk = keys.slice(i, i + MAX_DELETE_KEYS);
      const { Errors = [] } = await this.s3Client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      if (Errors.length > 0) {
        const [first] = Errors;
        throw new Error(
          `Couldn't delete ${Errors.length} objects from ${bucket}, e.g. ${first?.Key}: ${first?.Message}`,
        );
      }
    }
  }

  /** Deletes everything under `prefix`, which must be non-empty (this never empties a bucket). */
  public async deletePrefix({
    bucket,
    prefix,
  }: {
    bucket: string;
    prefix: string;
  }): Promise<number> {
    if (!prefix) throw new Error('deletePrefix needs a prefix');
    let deleted = 0;
    for await (const page of this.listObjects({ bucket, prefix })) {
      await this.deleteObjects({ bucket, keys: page.map((o) => o.key) });
      deleted += page.length;
    }
    return deleted;
  }
}
