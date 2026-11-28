// No imports, so the spec can run this file on Node's type stripping.

export type MediaFormat = 'jpeg' | 'heic' | 'png' | 'gif' | 'mov' | 'mp4';
export type ItemKind = 'photo' | 'video';

/** What the album shows, by lowercase extension. The upload script takes the same ones. */
const FORMATS: Record<string, MediaFormat> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.heic': 'heic',
  '.heif': 'heic',
  '.png': 'png',
  '.gif': 'gif',
  '.mov': 'mov',
  '.mp4': 'mp4',
};

export function mediaFormat(key: string): MediaFormat | undefined {
  const dot = key.lastIndexOf('.');
  if (dot < key.lastIndexOf('/') + 1) return undefined;
  return FORMATS[key.slice(dot).toLowerCase()];
}

export function kindOf(format: MediaFormat): ItemKind {
  return format === 'mov' || format === 'mp4' ? 'video' : 'photo';
}

/** An object as the bucket listing has it. */
export type ListedObject = {
  key: string;
  etag: string;
  sizeBytes: number;
  lastModified?: number;
};

export type S3Original = {
  bucket: string;
  key: string;
  etag: string;
  sizeBytes: number;
};

/** One item of an album, before its metadata is read. */
export type AlbumItem = {
  /** The key after the album's folder. */
  path: string;
  kind: ItemKind;
  format: MediaFormat;
  original: S3Original;
  /** A Live Photo's video. */
  motion?: S3Original;
  lastModified?: number;
};

/**
 * Whether `name` can be an album: one top-level folder's name, as `splitKey` takes the first
 * segment. A scan of one album sweeps that whole album, so `A/sub` must never pass for one.
 */
export function isAlbumName(name: string): boolean {
  return name !== '' && !name.includes('/') && !name.startsWith('.');
}

/**
 * Splits a key into its album (the top-level folder) and the path after it. Keys with no folder,
 * an empty segment, or a hidden segment (`.DS_Store`, `._IMG_1.JPG`) aren't album files.
 */
export function splitKey(key: string): { album: string; path: string } | null {
  const segments = key.split('/');
  if (segments.length < 2) return null;
  if (segments.some((s) => s === '' || s.startsWith('.'))) return null;
  const [album = '', ...rest] = segments;
  return { album, path: rest.join('/') };
}

/**
 * Turns a bucket listing into albums of items: media only, with each Live Photo's still and video
 * paired into one item. Returns albums by folder name, and how many objects weren't media.
 */
export function groupIntoAlbums(
  bucket: string,
  objects: ListedObject[],
): { albums: Map<string, AlbumItem[]>; ignored: number } {
  const byAlbum = new Map<string, AlbumItem[]>();
  let ignored = 0;
  for (const object of objects) {
    const split = splitKey(object.key);
    const format = mediaFormat(object.key);
    if (!split || !format) {
      ignored++;
      continue;
    }
    const items = byAlbum.get(split.album) ?? [];
    items.push({
      path: split.path,
      kind: kindOf(format),
      format,
      original: {
        bucket,
        key: object.key,
        etag: object.etag,
        sizeBytes: object.sizeBytes,
      },
      lastModified: object.lastModified,
    });
    byAlbum.set(split.album, items);
  }
  const albums = new Map<string, AlbumItem[]>();
  for (const [album, items] of byAlbum)
    albums.set(album, pairLivePhotos(items));
  return { albums, ignored };
}

/** Stills a Live Photo's video pairs with, best first. */
const STILL_PREFERENCE: MediaFormat[] = ['heic', 'jpeg'];

/**
 * Pairs each Live Photo's video (a .mov with the same name as a still in the same folder, like
 * IMG_5974.HEIC and IMG_5974.MOV) with its still. iPhones number photos and videos from one
 * counter, so a separate video never shares a still's name.
 */
export function pairLivePhotos(items: AlbumItem[]): AlbumItem[] {
  const groups = new Map<string, AlbumItem[]>();
  for (const item of items) {
    const stem = item.path.slice(0, item.path.lastIndexOf('.')).toLowerCase();
    const group = groups.get(stem) ?? [];
    group.push(item);
    groups.set(stem, group);
  }

  const result: AlbumItem[] = [];
  for (const group of groups.values()) {
    const movs = group.filter((item) => item.format === 'mov');
    const stills = STILL_PREFERENCE.flatMap((format) =>
      group.filter((item) => item.format === format),
    );
    const still = stills[0];
    const mov = movs[0];
    if (movs.length === 1 && still && mov) {
      result.push(
        ...group
          .map((item) =>
            item === still ? { ...item, motion: mov.original } : item,
          )
          .filter((item) => item !== mov),
      );
    } else {
      result.push(...group);
    }
  }
  return result.sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
}
