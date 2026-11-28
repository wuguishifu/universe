// Only type imports (which Node strips), so the spec can run this file on Node's type stripping.
import type { FfmpegRequest } from '@platform/ffmpeg-contracts';

import type { MediaFormat } from './album-objects';

// MARK: presets

/**
 * How everything's encoded. Change these, then reprocess with
 * `POST /api/items/reprocess { "kind": "video", "derivatives": ["hover"] }` (or whichever).
 */
export const PRESETS = {
  /** The grid's image: a photo, or a video's poster frame. */
  thumb: { maxSize: 512, quality: 80 },
  /** The lightbox's image. */
  display: { maxSize: 2048, quality: 82 },
  /** A web-playable copy of a video. */
  preview: {
    maxSize: 1920,
    bitrate: '5M',
    maxrate: '7.5M',
    bufsize: '10M',
    maxFps: 60,
    audioBitrate: '128k',
  },
  /** A video's hover loop: stills spread evenly across it, played as a short clip. */
  hover: { maxSize: 640, stills: 20, fps: 4, bitrate: '1M' },
  /** A Live Photo's hover loop: its motion as it is, smaller and muted. */
  motion: { maxSize: 640, bitrate: '1.5M' },
  /** Where a video's poster frame comes from, unless it's shorter than twice this. */
  posterAtMs: 1000,
  /** Lower runs first: photos make the album browsable fast; video transcodes fill in after. */
  priority: { photo: 1, video: 10 },
  /** Video jobs get this many times their duration, between the worker's default and cap. */
  timeout: { perDuration: 3, minMs: 10 * 60_000, maxMs: 120 * 60_000 },
} as const;

// MARK: requests

export type DerivativeKind = 'thumb' | 'display' | 'hover' | 'preview';

/** The parts of an item's job (Convex's `JobInput`) that decide its ffmpeg request. */
export type ItemJobInput = {
  itemId: string;
  token: string;
  kind: 'photo' | 'video';
  format: MediaFormat;
  original: { bucket: string; key: string };
  motion?: { bucket: string; key: string };
  media: { durationMs?: number; hdr?: boolean; motionHdr?: boolean };
  derivatives: DerivativeKind[];
};

export type ItemRequest = {
  request: FfmpegRequest;
  /** Where each derivative goes, by its output (and derivative) name. */
  outputs: Partial<Record<DerivativeKind, { bucket: string; key: string }>>;
  priority: number;
};

/**
 * The ffmpeg job that makes an item's requested derivatives. Each job writes under a folder named
 * for its token, so a new job never overwrites what the album is showing.
 */
export function buildItemRequest(
  input: ItemJobInput,
  derivedBucket: string,
): ItemRequest {
  const outputs: ItemRequest['outputs'] = {};
  for (const kind of input.derivatives) {
    outputs[kind] = {
      bucket: derivedBucket,
      key: derivativeKey(input.itemId, input.token, kind),
    };
  }
  const s3Outputs = Object.fromEntries(
    Object.entries(outputs).map(([name, location]) => [
      name,
      { type: 's3' as const, ...location },
    ]),
  );
  const wants = (kind: DerivativeKind) => input.derivatives.includes(kind);

  if (input.kind === 'video') {
    const { steps, timeoutMs } = videoSteps(input, wants);
    return {
      request: {
        inputs: { src: { type: 's3', ...input.original } },
        outputs: s3Outputs,
        steps,
        timeoutMs,
      },
      outputs,
      priority: PRESETS.priority.video,
    };
  }

  const inputs: FfmpegRequest['inputs'] = {
    src: { type: 's3', ...input.original },
  };
  const steps: FfmpegRequest['steps'] = [];
  // HEIC grids come in as a stream group whose stitching filtergraph ffmpeg makes itself, which
  // can't be combined with -vf/-filter_complex: decode to a plain image first.
  let source = '{{ in:src }}';
  if (input.format === 'heic' && (wants('thumb') || wants('display'))) {
    steps.push({
      args: ['-i', source, '-frames:v', '1', '{{ tmp:full.png }}'],
    });
    source = '{{ tmp:full.png }}';
  }
  // An animated GIF's display is animated too, below.
  const stills = {
    thumb: wants('thumb'),
    display: wants('display') && input.format !== 'gif',
  };
  if (stills.thumb || stills.display) {
    steps.push({ args: stillArgs(source, stills) });
  }
  if (input.format === 'gif' && wants('display')) {
    steps.push({
      args: [
        '-i',
        '{{ in:src }}',
        '-vf',
        fit(PRESETS.display.maxSize),
        '-c:v',
        'libwebp',
        '-quality',
        String(PRESETS.display.quality),
        '-loop',
        '0',
        '-an',
        '{{ out:display }}',
      ],
    });
  }
  if (wants('hover')) {
    if (!input.motion)
      throw new Error(`Photo ${input.itemId} has no motion for a hover loop`);
    inputs.motion = { type: 's3', ...input.motion };
    steps.push({
      args: [
        '-i',
        '{{ in:motion }}',
        '-an',
        '-vf',
        toneMap(input.media.motionHdr) + fit(PRESETS.motion.maxSize, true),
        ...h264(PRESETS.motion.bitrate),
        '{{ out:hover }}',
      ],
    });
  }
  return {
    request: { inputs, outputs: s3Outputs, steps },
    outputs,
    priority: PRESETS.priority.photo,
  };
}

function videoSteps(
  input: ItemJobInput,
  wants: (kind: DerivativeKind) => boolean,
): { steps: FfmpegRequest['steps']; timeoutMs: number } {
  const durationMs = input.media.durationMs;
  const steps: FfmpegRequest['steps'] = [];
  // Stills and the hover loop come from the preview when this job makes one: it's already SDR,
  // rotated and small. Otherwise they come from the original, tone mapped like the preview.
  let source = '{{ in:src }}';
  let toSdr = toneMap(input.media.hdr);
  if (wants('preview')) {
    const { preview } = PRESETS;
    steps.push({
      args: [
        '-i',
        '{{ in:src }}',
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-vf',
        toSdr + fit(preview.maxSize, true),
        '-fpsmax',
        String(preview.maxFps),
        ...h264(preview.bitrate, [
          '-maxrate',
          preview.maxrate,
          '-bufsize',
          preview.bufsize,
        ]),
        '-c:a',
        'aac',
        '-b:a',
        preview.audioBitrate,
        '-ac',
        '2',
        '{{ out:preview }}',
      ],
      expectedDurationMs: durationMs,
    });
    source = '{{ out:preview }}';
    toSdr = '';
  }
  if (wants('thumb') || wants('display')) {
    const posterAt =
      durationMs !== undefined && durationMs < 2 * PRESETS.posterAtMs
        ? durationMs / 2
        : PRESETS.posterAtMs;
    steps.push({
      args: stillArgs(
        source,
        { thumb: wants('thumb'), display: wants('display') },
        {
          seekSeconds: posterAt / 1000,
          prefilter: toSdr,
        },
      ),
    });
  }
  if (wants('hover')) {
    const { hover } = PRESETS;
    // Evenly spaced across the whole video; without a duration, one a second from the start.
    const rate = durationMs
      ? `${hover.stills}/${(durationMs / 1000).toFixed(3)}`
      : '1';
    steps.push({
      args: [
        '-i',
        source,
        '-an',
        '-vf',
        `${toSdr}fps=${rate},${fit(hover.maxSize, true)},setpts=N/(${hover.fps}*TB)`,
        '-frames:v',
        String(hover.stills),
        '-r',
        String(hover.fps),
        ...h264(hover.bitrate),
        '{{ out:hover }}',
      ],
    });
  }
  const { timeout } = PRESETS;
  const timeoutMs = Math.min(
    timeout.maxMs,
    Math.max(
      timeout.minMs,
      Math.round((durationMs ?? 0) * timeout.perDuration),
    ),
  );
  return { steps, timeoutMs };
}

/** WebP stills from one frame of `source`, decoded once and split for each size. */
function stillArgs(
  source: string,
  want: { thumb: boolean; display: boolean },
  {
    seekSeconds,
    prefilter = '',
  }: { seekSeconds?: number; prefilter?: string } = {},
): string[] {
  const sizes = (
    [
      ['thumb', PRESETS.thumb],
      ['display', PRESETS.display],
    ] as const
  )
    .filter(([name]) => want[name])
    .map(([name, preset], i) => ({
      name,
      preset,
      split: `[s${i}]`,
      label: `[${name}]`,
    }));
  const graph =
    sizes.length === 1
      ? sizes
          .map(
            ({ preset, label }) =>
              `[0:v:0]${prefilter}${fit(preset.maxSize)}${label}`,
          )
          .join('')
      : `[0:v:0]${prefilter}split=${sizes.length}${sizes.map(({ split }) => split).join('')};` +
        sizes
          .map(
            ({ preset, split, label }) =>
              `${split}${fit(preset.maxSize)}${label}`,
          )
          .join(';');
  return [
    ...(seekSeconds ? ['-ss', seekSeconds.toFixed(3)] : []),
    '-i',
    source,
    '-filter_complex',
    graph,
    ...sizes.flatMap(({ name, preset, label }) => [
      '-map',
      label,
      '-frames:v',
      '1',
      '-c:v',
      'libwebp',
      '-quality',
      String(preset.quality),
      `{{ out:${name} }}`,
    ]),
  ];
}

/** Scales down to fit in `maxSize` × `maxSize`, never up. Video encoders need even sizes. */
function fit(maxSize: number, even = false): string {
  return (
    `scale=w='min(${maxSize},iw)':h='min(${maxSize},ih)'` +
    `:force_original_aspect_ratio=decrease${even ? ':force_divisible_by=2' : ''}:flags=lanczos`
  );
}

/**
 * HDR (HLG or PQ) to SDR BT.709, ending in 8-bit 4:2:0 for H.264; just the 8-bit conversion for
 * SDR. Goes before the scale, with a trailing comma.
 */
function toneMap(hdr: boolean | undefined): string {
  return hdr
    ? 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,'
    : 'format=yuv420p,';
}

function h264(bitrate: string, extra: string[] = []): string[] {
  return [
    '-c:v',
    'h264_videotoolbox',
    '-b:v',
    bitrate,
    ...extra,
    '-profile:v',
    'high',
    '-tag:v',
    'avc1',
    '-movflags',
    '+faststart',
  ];
}

export function derivativeKey(
  itemId: string,
  token: string,
  kind: DerivativeKind,
): string {
  const extension = kind === 'hover' || kind === 'preview' ? 'mp4' : 'webp';
  return `${jobFolder(itemId, token)}${kind}.${extension}`;
}

/** Where one job of an item writes, in the derived bucket. */
export function jobFolder(itemId: string, token: string): string {
  return `${itemId}/${token.slice(0, 8)}/`;
}

type S3Location = { bucket: string; key: string };

/** What Convex's completeItem says about an item after a job, for cleaning up. */
export type Completion = {
  applied: boolean;
  /** The item's derivatives now. */
  inUse: S3Location[];
  /** Derivatives that completed jobs replaced, not yet deleted. */
  garbage: S3Location[];
};

/**
 * What to delete after completing a job: its own outputs if it was stale (unless the item uses
 * them, as after a retry of a job that was saved), and the item's garbage. Only ever objects these
 * name, in `bucket`, and never one in use: a newer job uploading for the same item writes
 * elsewhere, so nothing it makes is ever deleted here.
 */
export function toDelete(
  outputs: S3Location[],
  completion: Completion,
  bucket: string,
): S3Location[] {
  const id = ({ bucket, key }: S3Location) => `${bucket}/${key}`;
  const used = new Set(completion.inUse.map(id));
  const candidates = [
    ...(completion.applied ? [] : outputs),
    ...completion.garbage,
  ];
  const result = new Map<string, S3Location>();
  for (const object of candidates) {
    if (object.bucket === bucket && !used.has(id(object)))
      result.set(id(object), object);
  }
  return [...result.values()];
}
