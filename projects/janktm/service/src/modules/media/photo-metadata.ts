// Only imports exifr, so the spec can run this file on Node's type stripping.
import exifr from 'exifr';

export type PhotoMetadata = {
  /** "YYYY:MM:DD HH:MM:SS", local time. */
  exifDateTime?: string;
  /** e.g. "-07:00". */
  exifOffset?: string;
  /** EXIF orientation, 1-8. */
  orientation?: number;
  width?: number;
  height?: number;
};

const PICK = [
  'DateTimeOriginal',
  'CreateDate',
  'OffsetTimeOriginal',
  'OffsetTime',
  'Orientation',
  'ExifImageWidth',
  'ExifImageHeight',
  'ImageWidth',
  'ImageHeight',
];

/**
 * A photo's EXIF capture time, orientation and size. `source` is the file's bytes, or a URL that
 * exifr reads in ranged chunks (so a HEIC's EXIF is found wherever it is, without downloading the
 * photo). Undefined fields weren't there.
 */
export async function readPhotoMetadata(
  source: string | Uint8Array,
): Promise<PhotoMetadata> {
  const tags: Record<string, unknown> | undefined = await exifr.parse(source, {
    pick: PICK,
    // Raw values: dates as EXIF strings (exifr would read them in the machine's time zone) and
    // orientation as its number.
    reviveValues: false,
    translateValues: false,
  });
  if (!tags) return {};
  const text = (name: string) => {
    const value = tags[name];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  const number = (name: string) => {
    const value = tags[name];
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : undefined;
  };
  return dropUndefined({
    exifDateTime: text('DateTimeOriginal') ?? text('CreateDate'),
    exifOffset: text('OffsetTimeOriginal') ?? text('OffsetTime'),
    orientation: number('Orientation'),
    width: number('ExifImageWidth') ?? number('ImageWidth'),
    height: number('ExifImageHeight') ?? number('ImageHeight'),
  });
}

function dropUndefined<T extends object>(value: T): T {
  const copy = { ...value };
  for (const key in copy) {
    if (copy[key] === undefined) delete copy[key];
  }
  return copy;
}
