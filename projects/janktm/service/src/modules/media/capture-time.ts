// No imports, so the spec can run this file on Node's type stripping.

/** Mirrors `takenAtSource` in platform/convex/app/convex/album/validators.ts. */
export type TakenAtSource =
  | 'metadata'
  | 'metadataLocal'
  | 'mvhd'
  | 'filename'
  | 'folder'
  | 'lastModified';

/** Everything a scan might know about when a file was taken. */
export type CaptureClues = {
  /** EXIF DateTimeOriginal (or CreateDate), "YYYY:MM:DD HH:MM:SS", local time. */
  exifDateTime?: string;
  /** EXIF OffsetTimeOriginal (or OffsetTime), e.g. "-07:00". */
  exifOffset?: string;
  /** Apple's com.apple.quicktime.creationdate, ISO 8601 with an offset. */
  appleCreationDate?: string;
  /** A movie's mvhd creation time (UTC), in ms. */
  mvhdCreationTime?: number;
  /** The item's path within its album. */
  path: string;
  /** The album's folder name. */
  album: string;
  /** The object's S3 LastModified, in ms. */
  lastModified?: number;
};

/** Earlier than this is a camera with an unset clock (or a zeroed field), not a real date. */
const EARLIEST = Date.UTC(1990, 0, 1);

/**
 * When the file was taken, from the best clue it has:
 * 1. EXIF with an offset, or Apple's QuickTime creation date (also with one).
 * 2. EXIF without an offset, as local time in `timeZone`.
 * 3. A movie's mvhd creation time.
 * 4. A date (and maybe time) in the file name, as local time in `timeZone`.
 * 5. The date the album's folder name starts with, at noon in `timeZone`.
 * 6. When it was uploaded.
 */
export function captureTime(
  clues: CaptureClues,
  timeZone: string,
  now = Date.now(),
): { takenAt: number; source: TakenAtSource } {
  const plausible = (at: number | undefined): at is number =>
    at !== undefined &&
    Number.isFinite(at) &&
    at >= EARLIEST &&
    at <= now + 86_400_000;

  const exif = clues.exifDateTime
    ? parseExifDateTime(clues.exifDateTime)
    : null;
  if (exif && clues.exifOffset) {
    const offsetMin = parseOffset(clues.exifOffset);
    if (offsetMin !== null) {
      const at = Date.UTC(...exif) - offsetMin * 60_000;
      if (plausible(at)) return { takenAt: at, source: 'metadata' };
    }
  }
  const apple = clues.appleCreationDate
    ? parseIsoWithOffset(clues.appleCreationDate)
    : null;
  if (apple !== null && plausible(apple)) {
    return { takenAt: apple, source: 'metadata' };
  }
  if (exif) {
    const at = zonedToUtc(exif, timeZone);
    if (plausible(at)) return { takenAt: at, source: 'metadataLocal' };
  }
  if (plausible(clues.mvhdCreationTime)) {
    return { takenAt: clues.mvhdCreationTime, source: 'mvhd' };
  }
  const named = dateInName(clues.path.slice(clues.path.lastIndexOf('/') + 1));
  if (named) {
    const at = zonedToUtc(named, timeZone);
    if (plausible(at)) return { takenAt: at, source: 'filename' };
  }
  const folder = /^((?:19|20)\d{2})-(\d{2})-(\d{2})(?!\d)/.exec(clues.album);
  if (folder) {
    const at = zonedToUtc(
      [Number(folder[1]), Number(folder[2]) - 1, Number(folder[3]), 12, 0, 0],
      timeZone,
    );
    if (plausible(at)) return { takenAt: at, source: 'folder' };
  }
  return { takenAt: clues.lastModified ?? now, source: 'lastModified' };
}

/** [year, monthIndex, day, hour, minute, second], as `Date.UTC` takes them. */
type DateParts = [number, number, number, number, number, number];

/** "2022:06:12 15:30:12" (EXIF), also with "-" date separators or a "T". */
export function parseExifDateTime(value: string): DateParts | null {
  const match =
    /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [y, mo, d, h, mi, s] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  ];
  if (
    y === 0 ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > 31 ||
    h > 23 ||
    mi > 59 ||
    s > 60
  ) {
    return null;
  }
  return [y, mo - 1, d, h, mi, s];
}

/** "+02:00", "-0700" or "Z", in minutes east of UTC. */
export function parseOffset(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === 'Z') return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** "2022-06-12T15:30:12-0700" (Apple's format) or any ISO 8601 with an offset. */
function parseIsoWithOffset(value: string): number | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/.exec(
      value.trim(),
    );
  const [, localText, offsetText] = match ?? [];
  if (!localText || !offsetText) return null;
  const offset = parseOffset(offsetText);
  const local = parseExifDateTime(localText);
  if (offset === null || !local) return null;
  return Date.UTC(...local) - offset * 60_000;
}

/**
 * A date in a file name: IMG_20220612_153012, PXL_20220612_153012345, 20220612_153012,
 * "Screenshot 2022-06-12 at 15.30.12", "WhatsApp Image 2022-06-12 at 15.30.12". A date with no
 * time is noon.
 */
export function dateInName(name: string): DateParts | null {
  const match =
    /(?<!\d)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:(?:[ _T-]+|[ _]at[ _])([01]\d|2[0-3])[.:_-]?([0-5]\d)[.:_-]?([0-5]\d))?/i.exec(
      name,
    );
  if (!match) return null;
  const [y, mo, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (match[4] === undefined) return [y, mo - 1, d, 12, 0, 0];
  return [y, mo - 1, d, Number(match[4]), Number(match[5]), Number(match[6])];
}

/** Local time `parts` in `timeZone`, as ms since the epoch. */
export function zonedToUtc(parts: DateParts, timeZone: string): number {
  const asUtc = Date.UTC(...parts);
  // The zone's offset at the guess, then again at the corrected time in case that crossed DST.
  let at = asUtc - offsetMs(asUtc, timeZone);
  at = asUtc - offsetMs(at, timeZone);
  return at;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone`'s wall clock is ahead of UTC at `at`. */
function offsetMs(at: number, timeZone: string): number {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  const values: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(at)) {
    values[type] = Number(value);
  }
  const part = (name: string) => values[name] ?? 0;
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(at / 1000) * 1000;
}
