#!/usr/bin/env node
// Makes a proxy (see make-proxy.mjs) of every clip under a folder, for submit-backlog.mjs to upload.
//
// Usage: node tools/scripts/media/proxy-backlog.mjs <clips-dir> <out-dir> [--concurrency 2] [--encoder auto|videotoolbox|libx264]
//
// Writes <out-dir>/proxies/<sha256>.mp4 (named by the original's hash, so copies of a clip share
// one) and appends a line per clip to <out-dir>/manifest.jsonl. Safe to stop and rerun: clips
// already done (same path, size and modified time) are skipped, and failed ones are tried again.
// Each clip's game is the top-level folder it's in (<clips-dir>/<game>/...), or for clips straight
// in <clips-dir>, the one in its Medal file name.
import { appendFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  clipMetadata,
  forEachConcurrent,
  formatBytes,
  formatDuration,
  makeProxy,
  probe,
  sha256File,
  VIDEO_EXTENSIONS,
} from './lib.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    // Two at a time keeps an external HDD busy without making it seek between files constantly.
    concurrency: { type: 'string', default: '2' },
    encoder: { type: 'string', default: 'auto' },
  },
});
if (positionals.length !== 2) {
  console.error(
    'usage: proxy-backlog.mjs <clips-dir> <out-dir> [--concurrency 2] [--encoder auto|videotoolbox|libx264]',
  );
  process.exit(1);
}
const clipsDir = path.resolve(positionals[0]);
const outDir = path.resolve(positionals[1]);
const concurrency = Number(values.concurrency);
const manifestPath = path.join(outDir, 'manifest.jsonl');

await mkdir(path.join(outDir, 'proxies'), { recursive: true });

const done = await readDone(manifestPath);
const files = await findClips(clipsDir);
const todo = [];
for (const file of files) {
  const { size, mtimeMs } = await stat(file);
  if (done.get(file) !== `${size}:${mtimeMs}`)
    todo.push({ file, size, mtimeMs });
}
console.log(
  `${files.length} clips in ${clipsDir}: ${files.length - todo.length} already done, ${todo.length} to go`,
);

/** Proxies being made, by hash, so copies of a clip wait for the first instead of racing it. */
const making = new Map();
const startedAt = Date.now();
let finished = 0;
let failed = 0;
await forEachConcurrent(todo, concurrency, async ({ file, size, mtimeMs }) => {
  const relative = path.relative(clipsDir, file);
  const clipStartedAt = Date.now();
  let record;
  try {
    const sha256 = await sha256File(file);
    const proxyPath = path.join('proxies', `${sha256}.mp4`);
    const proxyFile = path.join(outDir, proxyPath);
    // A copy of a clip that's already done (or a proxy whose manifest line was lost).
    const existing = await stat(proxyFile).catch(() => null);
    let proxy;
    if (existing) {
      proxy = { ...(await probe(file)), proxyBytes: existing.size };
    } else if (making.has(sha256)) {
      // A copy of a clip that's being made right now.
      proxy = { ...(await making.get(sha256)), encoder: undefined };
    } else {
      const promise = makeProxy(file, proxyFile, { encoder: values.encoder });
      making.set(sha256, promise);
      try {
        proxy = await promise;
      } finally {
        making.delete(sha256);
      }
    }
    record = {
      status: 'ok',
      originalPath: file,
      sizeBytes: size,
      mtimeMs,
      sha256,
      durationSec: Math.round(proxy.durationSec * 1000) / 1000,
      ...clipMetadata(clipsDir, file),
      proxyPath,
      proxyBytes: proxy.proxyBytes,
      audioTracks: proxy.audioTracks,
      encoder: proxy.encoder,
      processedAt: new Date().toISOString(),
    };
  } catch (error) {
    failed++;
    record = {
      status: 'failed',
      originalPath: file,
      sizeBytes: size,
      mtimeMs,
      error: error instanceof Error ? error.message : String(error),
      processedAt: new Date().toISOString(),
    };
  }
  await appendFile(manifestPath, JSON.stringify(record) + '\n');

  finished++;
  const elapsed = Date.now() - startedAt;
  const eta = (elapsed / finished) * (todo.length - finished);
  const progress = `[${String(finished).padStart(String(todo.length).length)}/${todo.length}]`;
  const took = `${((Date.now() - clipStartedAt) / 1000).toFixed(1)}s`;
  if (record.status === 'ok') {
    const note = record.encoder ? '' : ' (proxy already existed)';
    console.log(
      `${progress} ✓ ${relative}  ${formatBytes(record.proxyBytes)}  ${took}${note}  eta ${formatDuration(eta)}`,
    );
  } else {
    console.log(`${progress} ✗ ${relative}: ${record.error}`);
  }
});

console.log(
  `Done in ${formatDuration(Date.now() - startedAt)}: ${todo.length - failed} ok, ${failed} failed. Manifest: ${manifestPath}`,
);
if (failed) process.exitCode = 1;

/** originalPath → "size:mtime" of each clip whose latest manifest line is a success. */
async function readDone(file) {
  const done = new Map();
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.status === 'ok') {
      done.set(record.originalPath, `${record.sizeBytes}:${record.mtimeMs}`);
    } else {
      done.delete(record.originalPath);
    }
  }
  return done;
}

async function findClips(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        // Skips macOS's "._" metadata files, which external drives are full of.
        !entry.name.startsWith('.') &&
        VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}
