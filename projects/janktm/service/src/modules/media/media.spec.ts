// Run with `nx test janktm-service` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// The package's entry can't load on Node's type stripping (extensionless imports, and bullmq);
// job.ts only imports zod, so the worker's own request validation runs here as it is.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { ffmpegRequestSchema } from '../../../../../../platform/ffmpeg/contracts/src/lib/job.ts';

import {
  groupIntoAlbums,
  type ListedObject,
  isAlbumName,
  mediaFormat,
  splitKey,
} from './album-objects.ts';
import {
  captureTime,
  dateInName,
  parseOffset,
  zonedToUtc,
} from './capture-time.ts';
import {
  buildItemRequest,
  derivativeKey,
  type ItemJobInput,
  PRESETS,
  toDelete,
} from './ffmpeg-requests.ts';
import { readMovieInfo } from './movie-info.ts';
import { readPhotoMetadata } from './photo-metadata.ts';

const LA = 'America/Los_Angeles';

// MARK: album objects

describe('splitKey', () => {
  it('splits off the album folder', () => {
    assert.deepEqual(
      splitKey("2022-06-12 GRADUATION!/Bo's Uplaods/IMG_5974.HEIC"),
      {
        album: '2022-06-12 GRADUATION!',
        path: "Bo's Uplaods/IMG_5974.HEIC",
      },
    );
  });

  it('skips files outside a folder, hidden files and empty segments', () => {
    assert.equal(splitKey('loose.jpg'), null);
    assert.equal(splitKey('album/.DS_Store'), null);
    assert.equal(splitKey('album/._IMG_1.JPG'), null);
    assert.equal(splitKey('album//IMG_1.JPG'), null);
  });
});

describe('isAlbumName', () => {
  it('takes one top-level folder, never a path in one', () => {
    assert.ok(isAlbumName('2022-06-12 GRADUATION!'));
    assert.ok(!isAlbumName('A/sub'));
    assert.ok(!isAlbumName('A/'));
    assert.ok(!isAlbumName(''));
    assert.ok(!isAlbumName('.hidden'));
  });
});

describe('mediaFormat', () => {
  it('knows the album formats, in any case', () => {
    assert.equal(mediaFormat('a/IMG_1.JPG'), 'jpeg');
    assert.equal(mediaFormat('a/IMG_1.heif'), 'heic');
    assert.equal(mediaFormat('a/clip.Mp4'), 'mp4');
    assert.equal(mediaFormat('a/raw.NEF'), undefined);
    assert.equal(mediaFormat('a.dir/noext'), undefined);
  });
});

describe('groupIntoAlbums', () => {
  const object = (key: string): ListedObject => ({
    key,
    etag: `"${key}"`,
    sizeBytes: 100,
  });
  const group = (...keys: string[]) =>
    groupIntoAlbums('originals', keys.map(object));

  it('groups media by album and counts the rest', () => {
    const { albums, ignored } = group(
      'A/1.jpg',
      'A/sub/2.png',
      'B/3.mp4',
      'B/notes.txt',
      'loose.jpg',
    );
    assert.deepEqual([...albums.keys()].sort(), ['A', 'B']);
    assert.deepEqual(
      albums.get('A')?.map((item) => item.path),
      ['1.jpg', 'sub/2.png'],
    );
    assert.equal(albums.get('B')?.[0]?.kind, 'video');
    assert.equal(ignored, 2);
  });

  it('pairs a Live Photo into one photo with motion', () => {
    const items = group('A/u/IMG_1.HEIC', 'A/u/IMG_1.MOV').albums.get('A');
    assert.equal(items?.length, 1);
    assert.equal(items?.[0]?.kind, 'photo');
    assert.equal(items?.[0]?.motion?.key, 'A/u/IMG_1.MOV');
  });

  it('prefers the HEIC when there is also a JPEG', () => {
    const items = group(
      'A/IMG_1.JPG',
      'A/IMG_1.HEIC',
      'A/IMG_1.MOV',
    ).albums.get('A');
    assert.deepEqual(
      items?.map((item) => [item.path, item.motion?.key ?? null]),
      [
        ['IMG_1.HEIC', 'A/IMG_1.MOV'],
        ['IMG_1.JPG', null],
      ],
    );
  });

  it("doesn't pair across folders, with MP4s, or a lone MOV", () => {
    const items = group(
      'A/x/IMG_1.HEIC',
      'A/y/IMG_1.MOV',
      'A/IMG_2.JPG',
      'A/IMG_2.MP4',
      'A/IMG_3.MOV',
    ).albums.get('A');
    assert.equal(items?.length, 5);
    assert.ok(items?.every((item) => !item.motion));
  });
});

// MARK: capture time

describe('captureTime', () => {
  const base = {
    path: 'IMG_1.HEIC',
    album: 'Party',
    lastModified: Date.UTC(2026, 0, 1),
  };

  it('uses EXIF with its offset', () => {
    const { takenAt, source } = captureTime(
      { ...base, exifDateTime: '2022:06:12 15:30:12', exifOffset: '-07:00' },
      LA,
    );
    assert.equal(source, 'metadata');
    assert.equal(new Date(takenAt).toISOString(), '2022-06-12T22:30:12.000Z');
  });

  it("uses Apple's creation date before EXIF without an offset", () => {
    const { takenAt, source } = captureTime(
      {
        ...base,
        exifDateTime: '2022:06:12 15:30:12',
        appleCreationDate: '2022-06-12T15:30:12+0200',
      },
      LA,
    );
    assert.equal(source, 'metadata');
    assert.equal(new Date(takenAt).toISOString(), '2022-06-12T13:30:12.000Z');
  });

  it('reads EXIF without an offset in the default zone, with DST', () => {
    const summer = captureTime(
      { ...base, exifDateTime: '2022:06:12 15:30:12' },
      LA,
    );
    const winter = captureTime(
      { ...base, exifDateTime: '2022:12:12 15:30:12' },
      LA,
    );
    assert.equal(summer.source, 'metadataLocal');
    assert.equal(
      new Date(summer.takenAt).toISOString(),
      '2022-06-12T22:30:12.000Z',
    );
    assert.equal(
      new Date(winter.takenAt).toISOString(),
      '2022-12-12T23:30:12.000Z',
    );
  });

  it('falls back to mvhd, then the file name, the folder, and upload time', () => {
    const mvhd = Date.UTC(2021, 4, 1, 12);
    assert.deepEqual(captureTime({ ...base, mvhdCreationTime: mvhd }, LA), {
      takenAt: mvhd,
      source: 'mvhd',
    });
    const named = captureTime(
      { ...base, path: 'x/PXL_20220612_153012345.jpg' },
      LA,
    );
    assert.equal(named.source, 'filename');
    assert.equal(
      new Date(named.takenAt).toISOString(),
      '2022-06-12T22:30:12.000Z',
    );
    const folder = captureTime(
      { ...base, album: '2022-06-12 GRADUATION!' },
      LA,
    );
    assert.equal(folder.source, 'folder');
    assert.equal(
      new Date(folder.takenAt).toISOString(),
      '2022-06-12T19:00:00.000Z',
    );
    assert.deepEqual(captureTime(base, LA), {
      takenAt: base.lastModified,
      source: 'lastModified',
    });
  });

  it('skips zeroed and impossible dates', () => {
    const zeroed = captureTime(
      { ...base, exifDateTime: '0000:00:00 00:00:00', mvhdCreationTime: 0 },
      LA,
    );
    assert.equal(zeroed.source, 'lastModified');
    const future = captureTime(
      { ...base, exifDateTime: '2099:01:01 00:00:00', exifOffset: 'Z' },
      LA,
      Date.UTC(2026, 0, 1),
    );
    assert.equal(future.source, 'lastModified');
  });
});

describe('dateInName', () => {
  it('reads the usual camera and app names', () => {
    assert.deepEqual(
      dateInName('IMG_20220612_153012.jpg'),
      [2022, 5, 12, 15, 30, 12],
    );
    assert.deepEqual(
      dateInName('20220612_153012.mp4'),
      [2022, 5, 12, 15, 30, 12],
    );
    assert.deepEqual(
      dateInName('WhatsApp Image 2022-06-12 at 15.30.12.jpeg'),
      [2022, 5, 12, 15, 30, 12],
    );
    assert.deepEqual(
      dateInName('Screenshot 2022-06-12 at 3.30.12 PM.png'),
      [2022, 5, 12, 12, 0, 0],
    );
  });

  it("doesn't find dates in plain numbers", () => {
    assert.equal(dateInName('IMG_5974.HEIC'), null);
    assert.equal(dateInName('DSC01234.JPG'), null);
  });
});

describe('time zones', () => {
  it('parses offsets', () => {
    assert.equal(parseOffset('-07:00'), -420);
    assert.equal(parseOffset('+0530'), 330);
    assert.equal(parseOffset('Z'), 0);
    assert.equal(parseOffset('nope'), null);
  });

  it('converts wall time around a DST change', () => {
    // 2022-03-13 01:30 PST is before the jump; 03:30 PDT after it.
    assert.equal(
      new Date(zonedToUtc([2022, 2, 13, 1, 30, 0], LA)).toISOString(),
      '2022-03-13T09:30:00.000Z',
    );
    assert.equal(
      new Date(zonedToUtc([2022, 2, 13, 3, 30, 0], LA)).toISOString(),
      '2022-03-13T10:30:00.000Z',
    );
  });
});

// MARK: movie info

/** An ISO box: size, type, then the body. */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = concat(...parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(ascii(type), 4);
  out.set(body, 8);
  return out;
}
const ascii = (text: string) => new TextEncoder().encode(text);
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
function bytes(size: number, write?: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(size);
  write?.(new DataView(out.buffer));
  return out;
}

/** A movie like an iPhone's: ftyp, a big mdat, then moov. */
function iphoneMovie(): Uint8Array {
  const created = Date.UTC(2022, 5, 12, 22, 30, 12) / 1000 + 2_082_844_800;
  const mvhd = box(
    'mvhd',
    bytes(100, (v) => {
      v.setUint32(4, created); // creation time
      v.setUint32(12, 600); // timescale
      v.setUint32(16, 600 * 12.5); // duration: 12.5s
    }),
  );
  const tkhd = box(
    'tkhd',
    bytes(84, (v) => {
      // version 0: flags, times, track ID, reserved, duration take 24 bytes; then 16 more.
      const matrix = 40;
      // 90° clockwise: a=0, b=1, c=-1, d=0, w=1.
      v.setInt32(matrix + 4, 65536);
      v.setInt32(matrix + 12, -65536);
      v.setInt32(matrix + 32, 1 << 30);
      v.setUint32(matrix + 36, 3840 * 65536);
      v.setUint32(matrix + 40, 2160 * 65536);
    }),
  );
  const hdlr = box('hdlr', bytes(4), ascii('mhlr'), ascii('vide'), bytes(12));
  const colr = box(
    'colr',
    ascii('nclx'),
    bytes(7, (v) => {
      v.setUint16(0, 9); // BT.2020 primaries
      v.setUint16(2, 18); // HLG
      v.setUint16(4, 9);
    }),
  );
  const hvc1 = box(
    'hvc1',
    new Uint8Array(78),
    box('hvcC', new Uint8Array(4)),
    colr,
  );
  const stsd = box(
    'stsd',
    bytes(8, (v) => v.setUint32(4, 1)),
    hvc1,
  );
  const trak = box(
    'trak',
    tkhd,
    box('mdia', hdlr, box('minf', box('stbl', stsd))),
  );
  const key = ascii('com.apple.quicktime.creationdate');
  const keys = box(
    'keys',
    bytes(8, (v) => v.setUint32(4, 1)),
    bytes(8, (v) => v.setUint32(0, 8 + key.length)),
    key,
  );
  keys.set(ascii('mdta'), 8 + 8 + 4);
  const value = ascii('2022-06-12T15:30:12-0700');
  const item = box(
    '\0\0\0\u0001',
    box(
      'data',
      bytes(8, (v) => v.setUint32(0, 1)),
      value,
    ),
  );
  const meta = box(
    'meta',
    box('hdlr', new Uint8Array(24)),
    keys,
    box('ilst', item),
  );
  return concat(
    box('ftyp', ascii('qt  '), new Uint8Array(4)),
    box('mdat', new Uint8Array(2_000_000)),
    box('moov', mvhd, trak, meta),
  );
}

describe('readMovieInfo', () => {
  it("reads an iPhone movie's metadata with a few small reads", async () => {
    const file = iphoneMovie();
    let bytesRead = 0;
    const info = await readMovieInfo(file.length, (start, end) => {
      const chunk = file.subarray(start, end + 1);
      bytesRead += chunk.length;
      return Promise.resolve(chunk);
    });
    assert.deepEqual(info, {
      durationMs: 12_500,
      creationTime: Date.UTC(2022, 5, 12, 22, 30, 12),
      width: 3840,
      height: 2160,
      rotationDeg: 90,
      hdr: true,
      appleCreationDate: '2022-06-12T15:30:12-0700',
    });
    assert.ok(bytesRead < 2_000, `read ${bytesRead} bytes`);
  });

  it('fails without a moov', async () => {
    const file = box('ftyp', ascii('isom'));
    await assert.rejects(
      readMovieInfo(file.length, (s, e) =>
        Promise.resolve(file.subarray(s, e + 1)),
      ),
      /No moov/,
    );
  });
});

// MARK: photo metadata

/** A JPEG that's just EXIF: SOI, an APP1 with IFD0 (orientation) and an EXIF IFD, EOI. */
function jpegWithExif(
  dateTime: string,
  offset: string,
  orientation: number,
): Uint8Array {
  const strings = [ascii(`${dateTime}\0`), ascii(`${offset}\0`)];
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 2 * 12 + 4;
  let dataAt = exifAt + 2 + 2 * 12 + 4;
  const tiff = new Uint8Array(
    dataAt + strings.reduce((n, s) => n + s.length, 0),
  );
  const v = new DataView(tiff.buffer);
  tiff.set(ascii('II'), 0);
  v.setUint16(2, 42, true);
  v.setUint32(4, ifd0At, true);
  const entry = (
    at: number,
    tag: number,
    type: number,
    count: number,
    value: number,
  ) => {
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    if (type === 3) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, value, true);
  };
  v.setUint16(ifd0At, 2, true);
  entry(ifd0At + 2, 0x0112, 3, 1, orientation);
  entry(ifd0At + 14, 0x8769, 4, 1, exifAt);
  v.setUint16(exifAt, 2, true);
  [0x9003, 0x9011].forEach((tag, i) => {
    const text = strings[i] ?? new Uint8Array();
    entry(exifAt + 2 + i * 12, tag, 2, text.length, dataAt);
    tiff.set(text, dataAt);
    dataAt += text.length;
  });
  const app1 = concat(ascii('Exif\0\0'), tiff);
  const header = bytes(4, (h) => {
    h.setUint16(0, 0xffe1);
    h.setUint16(2, app1.length + 2);
  });
  return concat(
    new Uint8Array([0xff, 0xd8]),
    header,
    app1,
    new Uint8Array([0xff, 0xd9]),
  );
}

describe('readPhotoMetadata', () => {
  it('reads the capture time, offset and orientation as EXIF has them', async () => {
    const jpeg = jpegWithExif('2022:06:12 15:30:12', '-07:00', 6);
    assert.deepEqual(await readPhotoMetadata(jpeg), {
      exifDateTime: '2022:06:12 15:30:12',
      exifOffset: '-07:00',
      orientation: 6,
    });
  });
});

// MARK: ffmpeg requests

describe('buildItemRequest', () => {
  const input = (overrides: Partial<ItemJobInput>): ItemJobInput => ({
    itemId: 'item1',
    token: '0123456789abcdef',
    kind: 'photo',
    format: 'jpeg',
    original: { bucket: 'originals', key: 'A/IMG_1.JPG' },
    media: {},
    derivatives: ['thumb', 'display'],
    ...overrides,
  });
  const build = (overrides: Partial<ItemJobInput>) => {
    const built = buildItemRequest(input(overrides), 'derived');
    // Every request has to pass the worker's own validation.
    ffmpegRequestSchema.parse(built.request);
    return built;
  };
  const allArgs = (built: ReturnType<typeof build>) =>
    built.request.steps.flatMap((step) => step.args).join(' ');

  it('makes both stills of a photo from one decode', () => {
    const built = build({});
    assert.equal(built.request.steps.length, 1);
    assert.deepEqual(built.outputs, {
      thumb: { bucket: 'derived', key: 'item1/01234567/thumb.webp' },
      display: { bucket: 'derived', key: 'item1/01234567/display.webp' },
    });
    assert.match(allArgs(built), /split=2/);
    assert.equal(built.priority, PRESETS.priority.photo);
  });

  it('decodes a HEIC to a plain image first', () => {
    const built = build({
      format: 'heic',
      original: { bucket: 'o', key: 'A/1.HEIC' },
    });
    assert.equal(built.request.steps.length, 2);
    assert.deepEqual(built.request.steps[0]?.args, [
      '-i',
      '{{ in:src }}',
      '-frames:v',
      '1',
      '{{ tmp:full.png }}',
    ]);
    assert.ok(built.request.steps[1]?.args.includes('{{ tmp:full.png }}'));
  });

  it('keeps an animated GIF animated for display', () => {
    const built = build({ format: 'gif' });
    assert.equal(built.request.steps.length, 2);
    assert.ok(built.request.steps[1]?.args.includes('-loop'));
  });

  it("makes a Live Photo's hover loop from its motion, tone mapped if HDR", () => {
    const built = build({
      motion: { bucket: 'originals', key: 'A/IMG_1.MOV' },
      media: { motionHdr: true },
      derivatives: ['thumb', 'display', 'hover'],
    });
    assert.equal(built.outputs.hover?.key, 'item1/01234567/hover.mp4');
    assert.match(allArgs(built), /\{\{ in:motion \}\}.*tonemap=tonemap=hable/);
  });

  it("can't make a hover loop for a photo without motion", () => {
    assert.throws(() => build({ derivatives: ['hover'] }), /no motion/);
  });

  it("makes a video's stills and hover loop from its preview", () => {
    const built = build({
      kind: 'video',
      format: 'mov',
      original: { bucket: 'originals', key: 'A/clip.MOV' },
      media: { durationMs: 40_000, hdr: true },
      derivatives: ['thumb', 'display', 'hover', 'preview'],
    });
    const [preview, stills, hover] = built.request.steps;
    assert.ok(preview?.args.includes('{{ out:preview }}'));
    assert.match(preview?.args.join(' ') ?? '', /tonemap/);
    assert.equal(preview?.expectedDurationMs, 40_000);
    assert.ok(stills?.args.includes('{{ out:preview }}'));
    assert.match(hover?.args.join(' ') ?? '', /fps=20\/40\.000/);
    // Already SDR, so no second tone mapping.
    assert.doesNotMatch(
      `${stills?.args.join(' ')} ${hover?.args.join(' ')}`,
      /tonemap/,
    );
    assert.equal(built.priority, PRESETS.priority.video);
    assert.equal(built.request.timeoutMs, PRESETS.timeout.minMs);
  });

  it('reprocesses just a hover loop from the original, with a longer timeout for long videos', () => {
    const built = build({
      kind: 'video',
      format: 'mp4',
      media: { durationMs: 30 * 60_000, hdr: true },
      derivatives: ['hover'],
    });
    assert.equal(built.request.steps.length, 1);
    assert.match(allArgs(built), /\{\{ in:src \}\}.*tonemap/);
    assert.equal(built.request.timeoutMs, 90 * 60_000);
  });

  it('names derivative keys by item, job and kind', () => {
    assert.equal(
      derivativeKey('abc', 'f00dfeed1234', 'preview'),
      'abc/f00dfeed/preview.mp4',
    );
  });
});

describe('toDelete', () => {
  const at = (key: string, bucket = 'derived') => ({ bucket, key });
  const outputs = [
    at('item1/bbbbbbbb/thumb.webp'),
    at('item1/bbbbbbbb/display.webp'),
  ];

  it("deletes what a saved job replaced, never the job's own outputs", () => {
    const deleted = toDelete(
      outputs,
      {
        applied: true,
        inUse: outputs,
        garbage: [at('item1/aaaaaaaa/thumb.webp')],
      },
      'derived',
    );
    assert.deepEqual(deleted, [at('item1/aaaaaaaa/thumb.webp')]);
  });

  it("keeps a retried job's outputs, and finishes deleting its garbage", () => {
    // The first attempt saved them, then failed to delete what they replaced.
    const deleted = toDelete(
      outputs,
      {
        applied: false,
        inUse: outputs,
        garbage: [at('item1/aaaaaaaa/thumb.webp')],
      },
      'derived',
    );
    assert.deepEqual(deleted, [at('item1/aaaaaaaa/thumb.webp')]);
  });

  it("deletes a superseded job's outputs, and only those", () => {
    // A newer job (cccccccc) may be uploading; nothing names its files, so they're safe.
    const deleted = toDelete(
      outputs,
      { applied: false, inUse: [at('item1/aaaaaaaa/thumb.webp')], garbage: [] },
      'derived',
    );
    assert.deepEqual(deleted, outputs);
  });

  it('never deletes what the item uses, or anything outside the derived bucket', () => {
    const deleted = toDelete(
      [],
      {
        applied: true,
        inUse: [at('item1/aaaaaaaa/thumb.webp')],
        garbage: [
          at('item1/aaaaaaaa/thumb.webp'),
          at('album/IMG_1.JPG', 'originals'),
        ],
      },
      'derived',
    );
    assert.deepEqual(deleted, []);
  });
});
