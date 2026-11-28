// No imports, so the spec can run this file on Node's type stripping.

/**
 * What a MOV/MP4 says about itself in its `moov` box, read with a few small ranged reads rather
 * than downloading it: iPhones put `moov` after the media, so it's found by hopping box headers.
 */
export type MovieInfo = {
  durationMs?: number;
  /** mvhd's creation time (UTC), in ms. */
  creationTime?: number;
  /** Apple's com.apple.quicktime.creationdate, which has the local offset. */
  appleCreationDate?: string;
  /** The video track's stored size, before rotation. */
  width?: number;
  height?: number;
  /** Clockwise display rotation of the video track. */
  rotationDeg?: number;
  /** An HLG or PQ transfer function, or Dolby Vision. */
  hdr?: boolean;
};

/** Bytes `start` to `end`, inclusive (like an HTTP Range). Shorter if the file ends first. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/** Bigger than any real moov (an hour of iPhone video has a few MB). */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_TOP_LEVEL_BOXES = 1000;
/** Seconds between 1904-01-01 (QuickTime's epoch) and 1970-01-01. */
const QUICKTIME_EPOCH_OFFSET_S = 2_082_844_800;

/** @throws if there's no moov, or the boxes don't add up. */
export async function readMovieInfo(
  sizeBytes: number,
  read: ReadRange,
): Promise<MovieInfo> {
  let offset = 0;
  for (let i = 0; i < MAX_TOP_LEVEL_BOXES && offset + 8 <= sizeBytes; i++) {
    const header = await read(offset, Math.min(offset + 15, sizeBytes - 1));
    if (header.length < 8) break;
    const view = dataView(header);
    let size = view.getUint32(0);
    const type = fourcc(header, 4);
    let headerSize = 8;
    if (size === 1) {
      if (header.length < 16) break;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = sizeBytes - offset;
    }
    if (size < headerSize) throw new Error(`Bad ${type} box at ${offset}`);
    if (type === 'moov') {
      if (size > MAX_MOOV_BYTES) throw new Error(`moov is ${size} bytes`);
      const moov = await read(offset, offset + size - 1);
      if (moov.length < size) throw new Error('File ends inside moov');
      return parseMoov(moov.subarray(headerSize));
    }
    offset += size;
  }
  throw new Error('No moov box');
}

/** Parses a moov box's contents (after its header). */
export function parseMoov(moov: Uint8Array): MovieInfo {
  const info: MovieInfo = {};
  for (const box of children(moov)) {
    if (box.type === 'mvhd') Object.assign(info, parseMvhd(box.body));
    else if (box.type === 'trak') {
      const track = parseTrak(box.body);
      // The first video track; Live Photos and iPhone videos have one.
      if (track && info.width === undefined) Object.assign(info, track);
    } else if (box.type === 'meta') {
      const date = appleCreationDate(box.body);
      if (date) info.appleCreationDate = date;
    } else if (box.type === 'udta') {
      const meta = children(box.body).find((child) => child.type === 'meta');
      const date = meta && appleCreationDate(meta.body);
      if (date && !info.appleCreationDate) info.appleCreationDate = date;
    }
  }
  return info;
}

type Box = { type: string; body: Uint8Array };

/** The boxes inside `data`, which must be a sequence of whole boxes. */
function children(data: Uint8Array): Box[] {
  const boxes: Box[] = [];
  const view = dataView(data);
  let offset = 0;
  while (offset + 8 <= data.length) {
    let size = view.getUint32(offset);
    const type = fourcc(data, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > data.length) break;
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size < headerSize || offset + size > data.length) break;
    boxes.push({
      type,
      body: data.subarray(offset + headerSize, offset + size),
    });
    offset += size;
  }
  return boxes;
}

function parseMvhd(body: Uint8Array): MovieInfo {
  const view = dataView(body);
  const version = body[0];
  let creation: number;
  let timescale: number;
  let duration: number;
  if (version === 1) {
    creation = Number(view.getBigUint64(4));
    timescale = view.getUint32(20);
    duration = Number(view.getBigUint64(24));
  } else {
    creation = view.getUint32(4);
    timescale = view.getUint32(12);
    duration = view.getUint32(16);
  }
  const info: MovieInfo = {};
  if (timescale > 0 && duration > 0) {
    info.durationMs = Math.round((duration / timescale) * 1000);
  }
  if (creation > QUICKTIME_EPOCH_OFFSET_S) {
    info.creationTime = (creation - QUICKTIME_EPOCH_OFFSET_S) * 1000;
  }
  return info;
}

/** A video track's size, rotation and HDR-ness; undefined for other tracks. */
function parseTrak(body: Uint8Array): MovieInfo | undefined {
  const boxes = children(body);
  const mdia = boxes.find((box) => box.type === 'mdia');
  const tkhd = boxes.find((box) => box.type === 'tkhd');
  if (!mdia || !tkhd) return undefined;
  const mdiaBoxes = children(mdia.body);
  const hdlr = mdiaBoxes.find((box) => box.type === 'hdlr');
  // hdlr: version/flags (4), pre_defined or QuickTime's component type (4), then the handler type.
  if (!hdlr || fourcc(hdlr.body, 8) !== 'vide') return undefined;

  const info: MovieInfo = { ...parseTkhd(tkhd.body) };
  const stsd = findPath(mdiaBoxes, ['minf', 'stbl', 'stsd']);
  if (stsd && isHdr(stsd.body)) info.hdr = true;
  return info;
}

function parseTkhd(body: Uint8Array): MovieInfo {
  const view = dataView(body);
  // version/flags, then times, track ID and duration: 20 bytes in version 0, 32 in version 1.
  const afterTimes = body[0] === 1 ? 4 + 32 : 4 + 20;
  // reserved (8), layer (2), alternate group (2), volume (2), reserved (2), then the matrix.
  const matrix = afterTimes + 16;
  if (body.length < matrix + 36 + 8) return {};
  const a = view.getInt32(matrix) / 65536;
  const b = view.getInt32(matrix + 4) / 65536;
  const width = view.getUint32(matrix + 36) / 65536;
  const height = view.getUint32(matrix + 40) / 65536;
  const degrees =
    (Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90 + 360) % 360;
  return {
    width: Math.round(width),
    height: Math.round(height),
    rotationDeg: degrees,
  };
}

/** Whether the first sample description is HDR: an HLG/PQ `colr`, or Dolby Vision config. */
function isHdr(stsd: Uint8Array): boolean {
  // version/flags (4), entry count (4), then sample entries (boxes).
  const [entry] = children(stsd.subarray(8));
  if (!entry) return false;
  if (entry.type.startsWith('dv')) return true;
  // A VisualSampleEntry's fields take 78 bytes before its child boxes.
  for (const box of children(entry.body.subarray(78))) {
    if (box.type === 'dvcC' || box.type === 'dvvC') return true;
    if (box.type === 'colr' && box.body.length >= 10) {
      const colourType = fourcc(box.body, 0);
      if (colourType !== 'nclx' && colourType !== 'nclc') continue;
      const transfer = dataView(box.body).getUint16(6);
      // 16: SMPTE ST 2084 (PQ), 18: ARIB STD-B67 (HLG).
      if (transfer === 16 || transfer === 18) return true;
    }
  }
  return false;
}

const APPLE_CREATION_DATE = 'com.apple.quicktime.creationdate';

/**
 * com.apple.quicktime.creationdate from a QuickTime `meta` box: `keys` names the items and
 * `ilst` holds them, the Nth item's box type being the index N.
 */
function appleCreationDate(meta: Uint8Array): string | undefined {
  // QuickTime's meta is a plain box, but ISO's has version/flags first: try both.
  for (const start of [0, 4]) {
    const boxes = children(meta.subarray(start));
    const keys = boxes.find((box) => box.type === 'keys');
    const ilst = boxes.find((box) => box.type === 'ilst');
    if (!keys || !ilst) continue;
    const index = keyIndex(keys.body, APPLE_CREATION_DATE);
    if (index === undefined) return undefined;
    // Item box types are the index as a big-endian uint32, read as four characters.
    const itemType = String.fromCharCode(
      (index >>> 24) & 0xff,
      (index >>> 16) & 0xff,
      (index >>> 8) & 0xff,
      index & 0xff,
    );
    for (const item of children(ilst.body)) {
      if (item.type !== itemType) continue;
      const data = children(item.body).find((box) => box.type === 'data');
      // data: type (4), locale (4), then the value; type 1 is UTF-8.
      if (!data || data.body.length < 8) return undefined;
      return new TextDecoder().decode(data.body.subarray(8)).trim();
    }
    return undefined;
  }
  return undefined;
}

/** The 1-based index of `name` in a `keys` box. */
function keyIndex(keys: Uint8Array, name: string): number | undefined {
  const view = dataView(keys);
  // version/flags (4), entry count (4), then entries: size (4), namespace (4), name.
  const count = view.getUint32(4);
  let offset = 8;
  for (let i = 1; i <= count && offset + 8 <= keys.length; i++) {
    const size = view.getUint32(offset);
    if (size < 8) return undefined;
    const key = new TextDecoder().decode(
      keys.subarray(offset + 8, offset + size),
    );
    if (key === name) return i;
    offset += size;
  }
  return undefined;
}

function findPath(boxes: Box[], path: string[]): Box | undefined {
  let current: Box | undefined;
  let level = boxes;
  for (const type of path) {
    current = level.find((box) => box.type === type);
    if (!current) return undefined;
    level = children(current.body);
  }
  return current;
}

function fourcc(data: Uint8Array, offset: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + 4));
}

function dataView(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
