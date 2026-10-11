// Shared helpers for the media scripts. The proxy format here is the contract with
// clipper-service (projects/clipper/contracts/src/lib/clips.ts), and the reference for the
// Windows client: keep them in sync.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/**
 * What Gemini sees. Frame tokens don't depend on resolution, so this is about staying well under
 * the 20MB inline request limit while keeping enough frames to try fps up to 4.
 */
export const PROXY = {
  maxWidth: 854,
  maxHeight: 480,
  fps: 4,
  /** A keyframe every 2s, so trimming the proxy never has to start far from where it's asked. */
  gop: 8,
  videoKbps: 400,
  audioKbps: 64,
  /** Proxies are sent inline (base64), and the request has to fit in 20MB with the prompt. */
  maxBytes: 18 * 1024 * 1024,
  /** Long clips get a lower video bitrate so they still fit; this is what that aims for. */
  targetBytes: 15 * 1024 * 1024,
  /** Below this the frames are mush, so the clip is too long to proxy. */
  minVideoKbps: 100,
  /** The proxy must keep the original's timeline: Gemini's timestamps are applied to the original. */
  durationToleranceSec: 0.3,
};

export const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm']);

/** The S3 key clipper-service reads a clip's proxy from. */
export function proxyS3Key(sha256) {
  return `proxies/${sha256}.mp4`;
}

/**
 * Runs a command to completion and resolves with stdout. Rejects with the tail of stderr, since
 * ffmpeg is chatty there.
 */
export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.once('error', (error) =>
      reject(new Error(`Failed to start ${command}: ${error.message}`)),
    );
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        const tail = stderr.trim().split('\n').slice(-5).join('\n');
        reject(
          new Error(`${path.basename(command)} exited with ${code}: ${tail}`),
        );
      }
    });
  });
}

export async function probe(file) {
  const json = JSON.parse(
    await run(FFPROBE, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ]),
  );
  const durationSec = Number(json.format?.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`${file} has no duration`);
  }
  const streams = json.streams ?? [];
  return {
    durationSec,
    hasVideo: streams.some((s) => s.codec_type === 'video'),
    audioTracks: streams.filter((s) => s.codec_type === 'audio').length,
  };
}

let encodersCache;
/** 'videotoolbox' on a Mac whose ffmpeg has it, otherwise 'libx264'. */
export async function resolveEncoder(requested = 'auto') {
  if (requested !== 'auto') return requested;
  if (process.platform !== 'darwin') return 'libx264';
  encodersCache ??= await run(FFMPEG, ['-hide_banner', '-encoders']);
  return /\bh264_videotoolbox\b/.test(encodersCache)
    ? 'videotoolbox'
    : 'libx264';
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Medal names clips like "MedalTVCallofDutyBlackOps320260104203637101.mp4": the game with its
 * spaces dropped, then when it was recorded (YYYYMMDDHHmmssSSS, the PC's local time).
 */
export function parseMedalFilename(name) {
  const match =
    /^MedalTV(.*?)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})\.\w+$/.exec(
      name,
    );
  if (!match) return {};
  const [, game, year, month, day, hour, minute, second, ms] = match;
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > 31
  ) {
    return { game: game || undefined };
  }
  return {
    game: game || undefined,
    // No offset: Medal doesn't record the timezone.
    recordedAt: `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}`,
  };
}

/**
 * Medal sorts clips into a folder per game, so the folder a clip is in is its game. Clips straight
 * in the root (a flattened copy) fall back on the game in the file name.
 */
export function clipMetadata(root, file) {
  const fromName = parseMedalFilename(path.basename(file));
  const folder = path.relative(root, path.dirname(file));
  return {
    game: folder ? path.basename(folder) : fromName.game,
    recordedAt: fromName.recordedAt,
  };
}

/**
 * Makes `output`, Gemini's copy of `input`: PROXY's size and frame rate, every audio track mixed to
 * mono, and the same timeline. Writes to a temporary file first, so `output` only ever exists
 * complete. Falls back on libx264 if VideoToolbox fails.
 */
export async function makeProxy(input, output, { encoder = 'auto' } = {}) {
  const source = await probe(input);
  if (!source.hasVideo) throw new Error('no video stream');

  // Leaves room for the audio, and turns the video down for clips long enough to need it.
  const budgetKbps = (PROXY.targetBytes * 8) / 1000 / source.durationSec;
  const videoKbps = Math.min(
    PROXY.videoKbps,
    Math.floor(budgetKbps - PROXY.audioKbps),
  );
  if (videoKbps < PROXY.minVideoKbps) {
    throw new Error(
      `${source.durationSec.toFixed(0)}s is too long for an inline proxy (would need ${videoKbps}kbps video)`,
    );
  }

  const resolved = await resolveEncoder(encoder);
  const partial = output.replace(/\.mp4$/, '') + '.partial.mp4';
  let used = resolved;
  try {
    await run(
      FFMPEG,
      ffmpegArgs({
        input,
        output: partial,
        encoder: resolved,
        source,
        videoKbps,
      }),
    );
  } catch (error) {
    if (resolved !== 'videotoolbox') throw error;
    used = 'libx264';
    await run(
      FFMPEG,
      ffmpegArgs({ input, output: partial, encoder: used, source, videoKbps }),
    );
  }

  try {
    const proxy = await probe(partial);
    const { size } = await stat(partial);
    const drift = Math.abs(proxy.durationSec - source.durationSec);
    if (drift > PROXY.durationToleranceSec) {
      throw new Error(
        `proxy is ${proxy.durationSec}s but the original is ${source.durationSec}s`,
      );
    }
    if (size > PROXY.maxBytes) {
      throw new Error(
        `proxy is ${(size / 1024 / 1024).toFixed(1)}MB, over the inline limit`,
      );
    }
    await rename(partial, output);
    return {
      durationSec: Math.round(source.durationSec * 1000) / 1000,
      audioTracks: source.audioTracks,
      proxyBytes: size,
      encoder: used,
      videoKbps,
    };
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

function ffmpegArgs({ input, output, encoder, source, videoKbps }) {
  const video = `[0:v:0]fps=${PROXY.fps},scale=w=${PROXY.maxWidth}:h=${PROXY.maxHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p[v]`;
  // Medal can record the game, the mic and Discord as separate tracks; Gemini needs to hear all of them.
  const tracks = Array.from(
    { length: source.audioTracks },
    (_, i) => `[0:a:${i}]`,
  ).join('');
  const audio =
    source.audioTracks > 1
      ? `${tracks}amix=inputs=${source.audioTracks}:duration=longest[a]`
      : source.audioTracks === 1
        ? '[0:a:0]anull[a]'
        : null;
  const maxrate = `${Math.round(videoKbps * 1.5)}k`;
  const bufsize = `${videoKbps * 3}k`;

  // prettier-ignore
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    ...(encoder === 'videotoolbox' ? ['-hwaccel', 'videotoolbox'] : []),
    '-i', input,
    '-filter_complex', audio ? `${video};${audio}` : video,
    '-map', '[v]',
    ...(audio ? ['-map', '[a]'] : []),
    ...(encoder === 'videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', `${videoKbps}k`, '-profile:v', 'main']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32']),
    '-maxrate', maxrate, '-bufsize', bufsize, '-g', String(PROXY.gop),
    ...(audio ? ['-c:a', 'aac', '-b:a', `${PROXY.audioKbps}k`, '-ac', '1'] : []),
    '-sn', '-dn', '-map_metadata', '-1',
    '-movflags', '+faststart',
    output,
  ];
}

export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h
    ? `${h}h${String(m).padStart(2, '0')}m`
    : `${m}m${String(s % 60).padStart(2, '0')}s`;
}

/** Calls `fn` on each item with at most `concurrency` running at once. */
export async function forEachConcurrent(items, concurrency, fn) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
}
