import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';

import { S3Service } from '@libs/nest-s3';
import { UniverseProcessor } from '@libs/queue';
import { api, type Id } from '@platform/convex-contracts';

import { EnvironmentService } from '../../config/environment';
import {
  JANKTM_QUEUE_CONFIG,
  type JanktmJob,
  type ScanResult,
} from '../../queues/queue';
import { ConvexService } from '../common/convex.service';
import {
  type AlbumItem,
  groupIntoAlbums,
  isAlbumName,
  type ListedObject,
} from '../media/album-objects';
import { ProcessingService } from '../processing/processing.service';

import { MetadataService } from './metadata.service';

/** Items per diff/upsert round trip to Convex. */
const BATCH = 100;

/**
 * Scans the originals bucket (or one album's folder): albums and items are created, updated and
 * deleted in Convex to match it, and new or changed items are queued for processing.
 */
@UniverseProcessor(JANKTM_QUEUE_CONFIG, 'scan')
export class ScanProcessor extends WorkerHost {
  private readonly logger = new Logger(ScanProcessor.name);

  constructor(
    private readonly s3: S3Service,
    private readonly convex: ConvexService,
    private readonly metadata: MetadataService,
    private readonly processing: ProcessingService,
    private readonly environmentService: EnvironmentService,
  ) {
    super();
  }

  override async process(job: JanktmJob<'scan'>): Promise<ScanResult> {
    const { album: onlyAlbum, scannedAt } = job.data;
    if (onlyAlbum !== undefined && !isAlbumName(onlyAlbum)) {
      // Scanning "A/sub" would sweep the rest of A away.
      throw new UnrecoverableError(`Not an album folder: ${onlyAlbum}`);
    }
    const bucket = this.environmentService.environment.albumOriginalsBucket;
    const result: ScanResult = {
      albums: 0,
      items: 0,
      added: 0,
      queued: 0,
      deletedItems: 0,
      deletedAlbums: 0,
      warnings: {},
    };

    const objects: ListedObject[] = [];
    for await (const page of this.s3.listObjects({
      bucket,
      prefix: onlyAlbum ? `${onlyAlbum}/` : undefined,
    })) {
      for (const object of page) {
        objects.push({
          key: object.key,
          etag: object.etag,
          sizeBytes: object.sizeBytes,
          lastModified: object.lastModified?.getTime(),
        });
      }
    }
    const { albums } = groupIntoAlbums(bucket, objects);
    const total = [...albums.values()].reduce(
      (n, items) => n + items.length,
      0,
    );
    this.logger.log(
      `Scanning ${total} items in ${albums.size} albums${onlyAlbum ? ` (${onlyAlbum})` : ''}`,
    );

    const progress = () =>
      job.updateProgress({
        ...result,
        total,
        warnings: Object.keys(result.warnings).length,
      });

    for (const [prefix, items] of [...albums].sort(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const { albumId } = await this.convex.mutation(
        api.album.scan.beginAlbum,
        {
          prefix,
          scannedAt,
        },
      );
      for (let i = 0; i < items.length; i += BATCH) {
        await this.scanBatch(
          albumId,
          prefix,
          items.slice(i, i + BATCH),
          scannedAt,
          result,
        );
        await progress();
      }
      result.deletedItems += await this.sweep(albumId, scannedAt);
      result.albums++;
    }

    // Albums whose folders are gone: all of them for a full scan, or the one scanned if it's empty.
    const stale = await this.convex.query(api.album.scan.staleAlbums, {
      scannedAt,
    });
    for (const { albumId, prefix } of stale) {
      if (
        onlyAlbum !== undefined &&
        (prefix !== onlyAlbum || albums.has(prefix))
      )
        continue;
      result.deletedItems += await this.sweep(albumId, scannedAt);
      const { deleted } = await this.convex.mutation(
        api.album.scan.deleteAlbum,
        {
          albumId,
          scannedAt,
        },
      );
      if (deleted) result.deletedAlbums++;
    }

    await progress();
    this.logger.log(
      `Scan done: ${JSON.stringify({ ...result, warnings: Object.keys(result.warnings).length })}`,
    );
    return result;
  }

  private async scanBatch(
    albumId: Id<'albumAlbums'>,
    prefix: string,
    items: AlbumItem[],
    scannedAt: number,
    result: ScanResult,
  ): Promise<void> {
    const scanned = items.map(toScanned);
    const diff = await this.convex.query(api.album.scan.diffItems, {
      albumId,
      items: scanned,
    });
    const stateOf = new Map(diff.map(({ path, state }) => [path, state]));

    const toRead = items.filter(
      (item) => stateOf.get(item.path) !== 'unchanged',
    );
    const metadata = await mapConcurrent(
      toRead,
      this.environmentService.environment.albumScanConcurrency,
      async (item) => ({ item, ...(await this.metadata.read(prefix, item)) }),
    );
    const changed = metadata.map(
      ({ item, media, takenAt, takenAtSource, warning }) => {
        if (warning) result.warnings[item.original.key] = warning;
        return { ...toScanned(item), media, takenAt, takenAtSource };
      },
    );
    const unchanged = items
      .filter((item) => stateOf.get(item.path) === 'unchanged')
      .map((item) => item.path);

    const { toQueue, added } = await this.convex.mutation(
      api.album.scan.upsertItems,
      {
        albumId,
        scannedAt,
        changed,
        unchanged,
      },
    );
    result.items += items.length;
    result.added += added;
    result.queued += await this.processing.enqueue(toQueue);
  }

  /** Deletes the album's items this scan didn't see, and their derivatives. */
  private async sweep(
    albumId: Id<'albumAlbums'>,
    scannedAt: number,
  ): Promise<number> {
    const bucket = this.environmentService.environment.albumDerivedBucket;
    let deleted = 0;
    for (;;) {
      const itemIds = await this.convex.query(api.album.scan.staleItems, {
        albumId,
        scannedAt,
      });
      if (itemIds.length === 0) return deleted;
      // Files first: if this fails, the items are still there to find next time.
      for (const itemId of itemIds) {
        await this.s3.deletePrefix({ bucket, prefix: `${itemId}/` });
      }
      const result = await this.convex.mutation(api.album.scan.deleteItems, {
        albumId,
        scannedAt,
        itemIds,
      });
      deleted += result.deleted;
    }
  }
}

/** What Convex's scan functions take for an item. */
function toScanned({ path, kind, original, motion }: AlbumItem) {
  return motion ? { path, kind, original, motion } : { path, kind, original };
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const entries = items.entries();
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      // One iterator for every worker, so each item is taken once.
      for (const [i, item] of entries) results[i] = await fn(item);
    },
  );
  await Promise.all(workers);
  return results;
}
