import { Injectable } from '@nestjs/common';

import { S3Service } from '@libs/nest-s3';

import { EnvironmentService } from '../../config/environment';
import type { MediaInfo } from '../common/album-types';
import { withoutUndefined } from '../common/without-undefined';
import type { AlbumItem, S3Original } from '../media/album-objects';
import {
  captureTime,
  type CaptureClues,
  type TakenAtSource,
} from '../media/capture-time';
import { type MovieInfo, readMovieInfo } from '../media/movie-info';
import { readPhotoMetadata } from '../media/photo-metadata';

export type ItemMetadata = {
  media: MediaInfo;
  takenAt: number;
  takenAtSource: TakenAtSource;
  /** Why some metadata couldn't be read; the item still gets the best capture time it can. */
  warning?: string;
};

/**
 * Reads what an item's files say about themselves, without downloading them: EXIF through a
 * presigned URL that exifr reads in ranged chunks, and a movie's moov box with ranged GETs.
 */
@Injectable()
export class MetadataService {
  constructor(
    private readonly s3: S3Service,
    private readonly environmentService: EnvironmentService,
  ) {}

  public async read(album: string, item: AlbumItem): Promise<ItemMetadata> {
    const clues: CaptureClues = {
      path: item.path,
      album,
      lastModified: item.lastModified,
    };
    let media: MediaInfo = {};
    const warnings: string[] = [];

    if (item.kind === 'video') {
      try {
        const movie = await this.movieInfo(item.original);
        media = mediaFromMovie(movie);
        clues.appleCreationDate = movie.appleCreationDate;
        clues.mvhdCreationTime = movie.creationTime;
      } catch (error) {
        warnings.push(`moov: ${messageOf(error)}`);
      }
    } else {
      // exifr reads JPEG, HEIC and PNG; a GIF has no EXIF.
      if (item.format !== 'gif') {
        try {
          const url = await this.s3.getSignedUrl(item.original);
          const photo = await readPhotoMetadata(url);
          media = withoutUndefined({
            width: photo.width,
            height: photo.height,
            orientation: photo.orientation,
          });
          clues.exifDateTime = photo.exifDateTime;
          clues.exifOffset = photo.exifOffset;
        } catch (error) {
          warnings.push(`EXIF: ${messageOf(error)}`);
        }
      }
      if (item.motion) {
        try {
          const motion = await this.movieInfo(item.motion);
          if (motion.hdr) media = { ...media, motionHdr: true };
          // A Live Photo's video has Apple's creation date, with the offset its EXIF may lack.
          clues.appleCreationDate = motion.appleCreationDate;
        } catch (error) {
          warnings.push(`motion moov: ${messageOf(error)}`);
        }
      }
    }

    const { takenAt, source } = captureTime(
      clues,
      this.environmentService.environment.albumDefaultTimeZone,
    );
    return {
      media,
      takenAt,
      takenAtSource: source,
      ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {}),
    };
  }

  private movieInfo(object: S3Original): Promise<MovieInfo> {
    return readMovieInfo(object.sizeBytes, (start, end) =>
      this.s3.getObjectRange({
        bucket: object.bucket,
        key: object.key,
        start,
        end,
      }),
    );
  }
}

function mediaFromMovie(movie: MovieInfo): MediaInfo {
  return withoutUndefined({
    width: movie.width,
    height: movie.height,
    durationMs: movie.durationMs,
    rotationDeg: movie.rotationDeg || undefined,
    hdr: movie.hdr,
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
