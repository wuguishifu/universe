// End-to-end check of the ffmpeg worker: makes a 10s test clip, uploads it, and runs two jobs on
// the worker straight through its queue (no flow):
//   1. trim it to 5s with h264_videotoolbox into a scratch file, then remux that with faststart
//      and grab a thumbnail from it, checking the outputs, progress and job log
//   2. ask for an encoder that doesn't exist, checking it fails at once instead of retrying
// Everything it uploads or queues is deleted afterwards.
//
//   nx serve ffmpeg-worker   # in another terminal
//   node tools/scripts/ffmpeg/smoke.mjs [--bucket clipper] [--redis-url redis://127.0.0.1:6379]
//
// S3 credentials come from tools/scripts/s3/.env.local (nx setup environment).
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Queue, QueueEvents } from 'bullmq';
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

config({ path: path.join(import.meta.dirname, '../s3/.env.local') });

const { values } = parseArgs({
  options: {
    bucket: { type: 'string', default: 'clipper' },
    'redis-url': { type: 'string', default: 'redis://127.0.0.1:6379' },
  },
});
const bucket = values.bucket;
const redisUrl = new URL(values['redis-url']);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  password: redisUrl.password || undefined,
};
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const queue = new Queue('ffmpeg-queue', {
  connection,
  prefix: 'ffmpeg-worker-queue',
});
const events = new QueueEvents('ffmpeg-queue', {
  connection,
  prefix: 'ffmpeg-worker-queue',
});

const id = `smoke-${Date.now()}`;
const prefix = `ffmpeg-smoke/${id}`;
const keys = {
  source: `${prefix}/source.mp4`,
  trimmed: `${prefix}/trimmed.mp4`,
  thumb: `${prefix}/thumb.jpg`,
};
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

const dir = await mkdtemp(path.join(tmpdir(), 'ffmpeg-smoke-'));
const jobIds = [];
try {
  // prettier-ignore
  const made = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=10:size=1280x720:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
    '-c:v', 'h264_videotoolbox', '-b:v', '4M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path.join(dir, 'source.mp4'),
  ]);
  if (made.status !== 0)
    throw new Error(`Couldn't make the test clip: ${made.stderr}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: keys.source,
      Body: await readFile(path.join(dir, 'source.mp4')),
      ContentType: 'video/mp4',
    }),
  );
  console.log(`Uploaded s3://${bucket}/${keys.source}`);

  // MARK: a trim and a thumbnail
  const s3Object = (key) => ({ type: 's3', bucket, key });
  const job = await queue.add(
    'run',
    {
      inputs: { clip: s3Object(keys.source) },
      outputs: { trimmed: s3Object(keys.trimmed), thumb: s3Object(keys.thumb) },
      steps: [
        {
          // prettier-ignore
          args: ['-ss', '2', '-to', '7', '-i', '{{ in:clip }}', '-c:v', 'h264_videotoolbox', '-b:v', '4M', '-c:a', 'aac', '{{ tmp:trimmed.mp4 }}'],
          expectedDurationMs: 5000,
        },
        {
          // prettier-ignore
          args: ['-i', '{{tmp:trimmed.mp4}}', '-map', '0', '-c', 'copy', '-movflags', '+faststart', '{{ out:trimmed }}', '-map', '0:v', '-frames:v', '1', '{{ out:thumb }}'],
        },
      ],
    },
    { jobId: `${id}-trim`, attempts: 1 },
  );
  jobIds.push(job.id);
  const result = await job.waitUntilFinished(events, 120_000);
  const trimmed = result.outputs.trimmed;
  const video = trimmed?.probe?.streams.find((s) => s.type === 'video');
  check(
    Math.abs((trimmed?.probe?.durationMs ?? 0) - 5000) < 200,
    `trimmed to ~5s (${trimmed?.probe?.durationMs}ms)`,
  );
  check(
    video?.codec === 'h264' && video.width === 1280,
    `h264 1280px video (${video?.codec} ${video?.width}x${video?.height})`,
  );
  check(
    trimmed?.contentType === 'video/mp4' && trimmed.sizeBytes > 0,
    `trimmed is video/mp4, ${trimmed?.sizeBytes} bytes`,
  );
  check(
    result.outputs.thumb?.contentType === 'image/jpeg',
    'thumbnail is image/jpeg',
  );
  check(
    result.analytics.stepsMs.length === 2,
    `analytics for both steps (${result.analytics.stepsMs.join(', ')}ms)`,
  );
  for (const key of [keys.trimmed, keys.thumb]) {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    check(head.ContentLength > 0, `s3://${bucket}/${key} exists`);
  }
  const finished = await queue.getJob(job.id);
  check(finished?.progress === 100, `progress is 100 (${finished?.progress})`);
  const { logs } = await queue.getJobLogs(job.id);
  check(
    logs.some((line) =>
      line.startsWith('step 1/2: ffmpeg -ss 2 -to 7 -i in/clip.mp4'),
    ),
    'log shows step 1 with relative paths',
  );
  check(
    logs.some((line) => line.startsWith('step 2/2: done')),
    'log shows step 2 finishing',
  );
  console.log(logs.map((line) => `  | ${line}`).join('\n'));

  // MARK: bad args
  const bad = await queue.add(
    'run',
    {
      inputs: { clip: s3Object(keys.source) },
      outputs: { out: s3Object(`${prefix}/never.mp4`) },
      steps: [
        {
          args: [
            '-i',
            '{{ in:clip }}',
            '-c:v',
            'no_such_encoder',
            '{{ out:out }}',
          ],
        },
      ],
    },
    {
      jobId: `${id}-bad`,
      attempts: 3,
      backoff: { type: 'fixed', delay: 1000 },
    },
  );
  jobIds.push(bad.id);
  const error = await bad.waitUntilFinished(events, 60_000).then(
    () => null,
    (e) => e,
  );
  const failed = await queue.getJob(bad.id);
  check(
    error !== null && (await failed?.getState()) === 'failed',
    'bad encoder fails',
  );
  check(
    failed?.attemptsMade === 1,
    `without retrying (${failed?.attemptsMade} attempt)`,
  );
  check(
    /no_such_encoder|Unknown encoder/.test(failed?.failedReason ?? ''),
    `with ffmpeg's error: ${failed?.failedReason?.split('\n').at(-1)}`,
  );
} finally {
  await Promise.all(jobIds.map((jobId) => queue.remove(jobId).catch(() => {})));
  await Promise.all(
    [...Object.values(keys), `${prefix}/never.mp4`].map((key) =>
      s3
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .catch(() => {}),
    ),
  );
  await rm(dir, { recursive: true, force: true });
  await Promise.all([queue.close(), events.close()]);
}
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exitCode = failures ? 1 : 0;
