#!/usr/bin/env node
// Uploads the proxies proxy-backlog.mjs made and starts a clipper-service run on them.
//
// Usage: node tools/scripts/media/submit-backlog.mjs <out-dir> [options]
//   --api-url <url>       clipper-service, e.g. http://clipper-service:3008 (or CLIPPER_API_URL)
//   --token <token>       its API_TOKEN (or API_TOKEN)
//   --options <json>      run options, e.g. '{"media":"audio","tailSeconds":45}' (defaults otherwise)
//   --label <text>        shown in the client, e.g. "audio, last 45s"
//   --sample <n>          a random n of the clips (for trying options out) instead of all of them
//   --game <name>         only clips from this game (folder name)
//   --run <runId>         add to this run instead of starting one
//   --upload-only         upload, but don't start a run
//   --dry-run             say what would happen
//
// Uploads straight to S3 with the credentials in tools/scripts/s3/.env.local (or ENV_FILE),
// skipping proxies already there, into the bucket clipper-service reads (CLIPPER_S3_BUCKET,
// default "clipper"). Safe to rerun: clips already in the run are skipped.
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from 'dotenv';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  clipperApi,
  forEachConcurrent,
  formatBytes,
  positiveIntArg,
  proxyS3Key,
} from './lib.mjs';

config({ path: path.join(import.meta.dirname, '.env.local') });

/** clipper-service's MAX_CLIPS_PER_REQUEST. */
const CHUNK = 500;
const UPLOAD_CONCURRENCY = 4;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'api-url': { type: 'string', default: process.env.CLIPPER_API_URL },
    token: { type: 'string', default: process.env.API_TOKEN },
    options: { type: 'string' },
    label: { type: 'string' },
    sample: { type: 'string' },
    game: { type: 'string' },
    run: { type: 'string' },
    'upload-only': { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (positionals.length !== 1) {
  console.error(
    'usage: submit-backlog.mjs <out-dir> [--api-url URL] [--token T] [--options JSON] [--label L] [--sample N] [--game G] [--run ID] [--upload-only] [--dry-run]',
  );
  process.exit(1);
}
const outDir = path.resolve(positionals[0]);
const submitting = !values['upload-only'];
if (submitting && (!values['api-url'] || !values.token)) {
  console.error(
    'Set --api-url and --token (or CLIPPER_API_URL and API_TOKEN), or pass --upload-only',
  );
  process.exit(1);
}
const runOptions = values.options ? JSON.parse(values.options) : undefined;

const bucket = process.env.CLIPPER_S3_BUCKET || 'clipper';
const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

let clips = await readClips(path.join(outDir, 'manifest.jsonl'));
if (values.game) clips = clips.filter((clip) => clip.game === values.game);
if (values.sample) {
  const sample = positiveIntArg('--sample', values.sample);
  clips = shuffle(clips).slice(0, sample);
}
const totalBytes = clips.reduce((sum, clip) => sum + clip.proxyBytes, 0);
console.log(
  `${clips.length} clips (${formatBytes(totalBytes)} of proxies) for s3://${bucket}`,
);
if (values['dry-run']) {
  console.log(
    submitting
      ? `Would upload them and ${values.run ? `add them to run ${values.run}` : 'start a run'} with options ${JSON.stringify(runOptions ?? {})}`
      : 'Would upload them',
  );
  process.exit(0);
}

let uploaded = 0;
let skipped = 0;
await forEachConcurrent(clips, UPLOAD_CONCURRENCY, async (clip) => {
  await upload(clip);
  if ((uploaded + skipped) % 100 === 0)
    console.log(`  ${uploaded + skipped}/${clips.length} checked`);
});
console.log(`Uploaded ${uploaded}, ${skipped} were already there`);
if (!submitting) process.exit(0);

const toInput = (clip) => ({
  sha256: clip.sha256,
  bucket,
  key: proxyS3Key(clip.sha256),
  durationSec: clip.durationSec,
  originalPath: clip.originalPath,
  game: clip.game,
  recordedAt: clip.recordedAt,
});
const api = clipperApi(values['api-url'], values.token);
let runId = values.run;
let queued = 0;
let alreadyInRun = 0;
for (let i = 0; i < clips.length; i += CHUNK) {
  const chunk = clips.slice(i, i + CHUNK).map(toInput);
  let result;
  try {
    result = runId
      ? await api('POST', `/api/runs/${runId}/clips`, { clips: chunk })
      : await api('POST', '/api/runs', {
          options: runOptions,
          label: values.label,
          clips: chunk,
        });
  } catch (error) {
    // A failed create cancels its run, but a failed add leaves the run with the clips before it.
    if (runId) {
      console.error(
        `Run ${runId} has the first ${i} of these clips. --run ${runId} adds to it (skipping clips already in it).`,
      );
    }
    throw error;
  }
  runId ??= result.runId;
  queued += result.queued;
  alreadyInRun += result.alreadyInRun;
  console.log(
    `  ${Math.min(i + CHUNK, clips.length)}/${clips.length} submitted`,
  );
}
console.log(
  `Run ${runId}: queued ${queued}${alreadyInRun ? `, ${alreadyInRun} were already in it` : ''}`,
);

/** The latest successful line per original, one per distinct clip (copies share a proxy). */
async function readClips(file) {
  const latest = new Map();
  for (const line of (await readFile(file, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    latest.set(record.originalPath, record);
  }
  const bySha = new Map();
  for (const record of latest.values()) {
    if (record.status === 'ok' && !bySha.has(record.sha256))
      bySha.set(record.sha256, record);
  }
  return [...bySha.values()];
}

async function upload(clip) {
  const key = proxyS3Key(clip.sha256);
  if (await exists(key)) {
    skipped++;
    return;
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(path.join(outDir, clip.proxyPath)),
      ContentLength: clip.proxyBytes,
      ContentType: 'video/mp4',
    }),
  );
  uploaded++;
}

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
