#!/usr/bin/env node
// Uploads the janktm album's photos and videos from a folder to the originals bucket, where
// janktm-service scans them.
//
// Usage: node tools/scripts/janktm-album/upload.mjs <dir> [options]
//   --bucket <name>       the originals bucket (or JANKTM_ALBUM_BUCKET; default "janktm-album")
//   --album <folder>      only this album (a folder directly in <dir>); repeat for more
//   --limit <n>           only the first n files (by path), e.g. a small set to test with
//   --sample <n>          a test seed instead of everything: n files of each kind (jpg, heic,
//                         Live Photo heic, Live Photo mov, plain mov, mp4, …), spread across
//                         the albums, with each Live Photo's other half. The same n picks the
//                         same files every time.
//   --concurrency <n>     files uploading at once (default 8)
//   --force               upload files that are already there too
//   --dry-run             list what would be uploaded
//
// Each folder directly in <dir> is an album, and a file's key is its path under <dir>, e.g.
// "2022-06-12 GRADUATION!/Bo's Uploads/IMG_5974.HEIC". Only photos and videos are uploaded (see
// MEDIA_TYPES); files directly in <dir> aren't in an album, so they're skipped.
//
// Safe to rerun: a file already there with the same size is skipped (use --force for one that
// changed without changing size). Nothing is ever deleted from the bucket. Each object gets a
// `Content-Disposition: attachment` with its file name, for the album's download links.
//
// S3 credentials come from this folder's .env.local (nx setup environment), or ENV_FILE.
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { config } from 'dotenv';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

config({
  path: process.env.ENV_FILE || path.join(import.meta.dirname, '.env.local'),
  quiet: true,
});

/** What the album shows, by lowercase extension. janktm-service's scan takes the same ones. */
const MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
};

/** Multipart above this, in parts this big: iPhone videos run to gigabytes. */
const PART_SIZE = 16 * 1024 * 1024;
const PARTS_AT_ONCE = 4;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    bucket: {
      type: 'string',
      default: process.env.JANKTM_ALBUM_BUCKET || 'janktm-album',
    },
    album: { type: 'string', multiple: true },
    limit: { type: 'string' },
    sample: { type: 'string' },
    concurrency: { type: 'string', default: '8' },
    force: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (positionals.length !== 1) {
  console.error(
    'usage: upload.mjs <dir> [--bucket B] [--album A]... [--limit N] [--sample N] [--concurrency N] [--force] [--dry-run]',
  );
  process.exit(1);
}
const root = path.resolve(positionals[0]);
const limit = values.limit && positiveInt('--limit', values.limit);
const sample = values.sample && positiveInt('--sample', values.sample);
const concurrency = positiveInt('--concurrency', values.concurrency);
const { bucket } = values;

// MARK: find the files

const { files, ignored, loose } = await findMedia(root, values.album);
files.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const sampled = sample ? sampleKinds(files, sample) : files;
const selected = limit ? sampled.slice(0, limit) : sampled;

const albums = new Set(selected.map((file) => file.key.split('/')[0]));
console.log(
  `${selected.length} files (${formatBytes(sum(selected))}) in ${albums.size} albums for s3://${bucket}`,
);
if (ignored.size > 0) {
  const counts = [...ignored].map(([ext, n]) => `${n} ${ext || '(none)'}`);
  console.log(`Ignoring other files: ${counts.join(', ')}`);
}
if (loose.length > 0) {
  console.log(
    `Skipping ${loose.length} files directly in ${root} (not in an album folder)`,
  );
}
if (values['dry-run']) {
  for (const file of selected) console.log(`  ${file.key}`);
  process.exit(0);
}

// MARK: upload them

const missing = [
  'S3_ENDPOINT',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(
    `${missing.join(', ')} not set: run \`nx setup environment\` for tools/scripts/janktm-album/.env.local, or set ENV_FILE`,
  );
  process.exit(1);
}
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  // Garage stores a multipart upload's checksum as one over its parts' checksums but serves it as
  // the whole object's, which fails SDK downloads' checksum checks. Don't send checksums at all.
  requestChecksumCalculation: 'WHEN_REQUIRED',
});

const counts = { uploaded: 0, skipped: 0, failed: 0 };
let uploadedBytes = 0;
const failures = [];
const startedAt = Date.now();
let lastLog = 0;

await forEachConcurrent(selected, concurrency, async (file) => {
  try {
    if (!values.force && (await isUploaded(file))) {
      counts.skipped++;
    } else {
      await upload(file);
      counts.uploaded++;
      uploadedBytes += file.size;
    }
  } catch (error) {
    counts.failed++;
    failures.push({ key: file.key, error });
  }
  const done = counts.uploaded + counts.skipped + counts.failed;
  if (Date.now() - lastLog > 5000 || done === selected.length) {
    lastLog = Date.now();
    const seconds = (Date.now() - startedAt) / 1000;
    console.log(
      `  ${done}/${selected.length}: ${counts.uploaded} uploaded (${formatBytes(uploadedBytes)}, ${formatBytes(uploadedBytes / seconds)}/s), ${counts.skipped} already there, ${counts.failed} failed`,
    );
  }
});

for (const { key, error } of failures) {
  console.error(`Failed: ${key}: ${error?.message ?? error}`);
}
console.log(
  `Uploaded ${counts.uploaded} (${formatBytes(uploadedBytes)}), ${counts.skipped} were already there, ${counts.failed} failed`,
);
process.exit(counts.failed > 0 ? 1 : 0);

// MARK: helpers

/**
 * The photos and videos under `dir`'s album folders (or just `onlyAlbums`), keyed by their path
 * under `dir`, plus counts of the other files by extension.
 */
async function findMedia(dir, onlyAlbums) {
  const files = [];
  const ignored = new Map();
  const loose = [];
  const wanted = onlyAlbums && new Set(onlyAlbums.map(nfc));

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (isHidden(entry.name)) continue;
    if (entry.isFile()) {
      loose.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (wanted && !wanted.has(nfc(entry.name))) continue;
    await walk(path.join(dir, entry.name), nfc(entry.name));
  }
  if (wanted) {
    const found = new Set(files.map((file) => file.key.split('/')[0]));
    for (const album of wanted) {
      if (!found.has(album)) console.warn(`No media in album "${album}"`);
    }
  }
  return { files, ignored, loose };

  async function walk(folder, keyPrefix) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      // macOS metadata (.DS_Store, ._ AppleDouble files) and anything else hidden.
      if (isHidden(entry.name)) continue;
      const full = path.join(folder, entry.name);
      // Keys are NFC: macOS can hand back names decomposed, and S3 keys are compared bytewise.
      const key = `${keyPrefix}/${nfc(entry.name)}`;
      if (entry.isDirectory()) {
        await walk(full, key);
        continue;
      }
      // Symlinks and the like are skipped; the album is regular files.
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const contentType = MEDIA_TYPES[ext];
      if (!contentType) {
        ignored.set(ext, (ignored.get(ext) ?? 0) + 1);
        continue;
      }
      const { size } = await stat(full);
      files.push({ path: full, key, size, contentType });
    }
  }
}

async function isUploaded(file) {
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: file.key }),
    );
    return head.ContentLength === file.size;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

async function upload(file) {
  await new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: file.key,
      Body: createReadStream(file.path),
      ContentType: file.contentType,
      // Garage ignores presigned URLs' response-content-disposition, so the album's "download
      // original" links rely on the object's own header.
      ContentDisposition: attachmentDisposition(path.basename(file.key)),
      ContentLength: file.size,
    },
    partSize: PART_SIZE,
    queueSize: PARTS_AT_ONCE,
  }).done();
}

/** `attachment` with an ASCII fallback name and the real one as RFC 5987 `filename*`. */
function attachmentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * `perKind` files of each kind, spread evenly through `files` (which are sorted, so across the
 * albums), plus each picked Live Photo's other half. A kind is the extension, with Live Photo
 * stills and videos (same folder and name, like janktm-service pairs them) apart from the rest.
 */
function sampleKinds(files, perKind) {
  const stem = (file) =>
    file.key.slice(0, file.key.lastIndexOf('.')).toLowerCase();
  const byStem = new Map();
  for (const file of files) {
    const group = byStem.get(stem(file)) ?? [];
    group.push(file);
    byStem.set(stem(file), group);
  }
  const ext = (file) => path.extname(file.key).toLowerCase();
  const STILLS = new Set(['.heic', '.heif', '.jpg', '.jpeg']);
  const partners = (file) => {
    const group = byStem.get(stem(file)) ?? [];
    const movs = group.filter((other) => ext(other) === '.mov');
    const stills = group.filter((other) => STILLS.has(ext(other)));
    return movs.length === 1 && stills.length > 0 ? group : [];
  };

  const kinds = new Map();
  for (const file of files) {
    const live =
      partners(file).length > 0 &&
      (ext(file) === '.mov' || STILLS.has(ext(file)));
    const kind = `${ext(file).slice(1)}${live ? ' (Live Photo)' : ''}`;
    const list = kinds.get(kind) ?? [];
    list.push(file);
    kinds.set(kind, list);
  }

  const picked = new Set();
  console.log('Sample:');
  for (const [kind, list] of [...kinds].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const n = Math.min(perKind, list.length);
    for (let i = 0; i < n; i++) {
      const file = list[Math.floor(((i + 0.5) * list.length) / n)];
      picked.add(file);
      for (const partner of partners(file)) picked.add(partner);
    }
    console.log(`  ${kind}: ${n} of ${list.length}`);
  }
  return files.filter((file) => picked.has(file));
}

function isHidden(name) {
  return name.startsWith('.');
}

function nfc(name) {
  return name.normalize('NFC');
}

async function forEachConcurrent(items, n, fn) {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(n, items.length) },
    async () => {
      while (next < items.length) await fn(items[next++]);
    },
  );
  await Promise.all(workers);
}

function sum(files) {
  return files.reduce((total, file) => total + file.size, 0);
}

function positiveInt(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) {
    console.error(`${name} must be a positive integer`);
    process.exit(1);
  }
  return n;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)}${units[unit]}`;
}
