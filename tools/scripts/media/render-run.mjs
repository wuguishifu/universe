#!/usr/bin/env node
// Cuts what a clipper-service run found out of the originals, and writes a page to watch them on,
// for checking whether a run's options are any good.
//
// Usage: node tools/scripts/media/render-run.mjs <out-dir> <runId> [options]
//   --api-url <url>       clipper-service, e.g. http://clipper-service:3008 (or CLIPPER_API_URL)
//   --token <token>       its API_TOKEN (or API_TOKEN)
//   --wait                wait for the run to finish first, showing progress
//   --pad <seconds>       extra before and after each moment (default 0: exactly what Gemini chose)
//   --concurrency <n>     cuts at once (default 2, for an external HDD)
//   --encoder <name>      auto|videotoolbox|libx264
//
// <out-dir> is the one proxy-backlog.mjs wrote: its manifest says where each original is. Cuts go
// in a folder per game, <out-dir>/renders/<runId>/<game>/, and <out-dir>/renders/<runId>/index.html
// (open it in a browser) has a video per moment, and the proxies of clips where nothing was found
// or that failed, to check what was missed. Cuts already made are kept, so it's quick to run again. A clip whose original isn't there (the drive isn't
// plugged in) is cut from its proxy instead, at 4fps.
import { config } from 'dotenv';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  audioFilter,
  clipperApi,
  FFMPEG,
  forEachConcurrent,
  formatDuration,
  nonNegativeNumberArg,
  positiveIntArg,
  probe,
  resolveEncoder,
  run,
  scaleFilter,
} from './lib.mjs';

config({ path: path.join(import.meta.dirname, '.env.local') });

const POLL_MS = 10_000;
/** Cuts are for watching, so 1080p is plenty and keeps them quick to make. */
const RENDER = { maxWidth: 1920, maxHeight: 1080, videoKbps: 8000 };

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'api-url': { type: 'string', default: process.env.CLIPPER_API_URL },
    token: { type: 'string', default: process.env.API_TOKEN },
    wait: { type: 'boolean', default: false },
    pad: { type: 'string', default: '0' },
    concurrency: { type: 'string', default: '2' },
    encoder: { type: 'string', default: 'auto' },
  },
});
if (positionals.length !== 2) {
  console.error(
    'usage: render-run.mjs <out-dir> <runId> [--api-url URL] [--token T] [--wait] [--pad S] [--concurrency N] [--encoder E]',
  );
  process.exit(1);
}
if (!values['api-url'] || !values.token) {
  console.error('Set --api-url and --token (or CLIPPER_API_URL and API_TOKEN)');
  process.exit(1);
}
const [outDirArg, runId] = positionals;
const outDir = path.resolve(outDirArg);
const renderDir = path.join(outDir, 'renders', runId);
const pad = nonNegativeNumberArg('--pad', values.pad);
const concurrency = positiveIntArg('--concurrency', values.concurrency);
const api = clipperApi(values['api-url'], values.token);

let runInfo = await api('GET', `/api/runs/${runId}`);
if (values.wait) {
  const startedAt = Date.now();
  while (runInfo.status === 'running') {
    const { queued, processing, done, failed, cancelled } = runInfo.counts;
    const total = queued + processing + done + failed + cancelled;
    const finished = done + failed + cancelled;
    const elapsed = Date.now() - startedAt;
    const eta = finished
      ? ` eta ${formatDuration((elapsed / finished) * (total - finished))}`
      : '';
    console.log(
      `  ${finished}/${total} (${processing} processing), ${runInfo.found} found, ${failed} failed, $${runInfo.spendUsd.toFixed(2)}${eta}`,
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    runInfo = await api('GET', `/api/runs/${runId}`);
  }
} else if (runInfo.status === 'running') {
  console.log(
    `Run ${runId} is still running; rendering what's done so far (--wait to wait for it)`,
  );
}

const clipJobs = [];
for (let cursor; ;) {
  const query = new URLSearchParams({ limit: '500' });
  if (cursor) query.set('cursor', cursor);
  const page = await api('GET', `/api/runs/${runId}/clip-jobs?${query}`);
  clipJobs.push(...page.clipJobs);
  if (!page.cursor) break;
  cursor = page.cursor;
}

const originals = await readOriginals(path.join(outDir, 'manifest.jsonl'));
await mkdir(renderDir, { recursive: true });

/** Every moment found, best first. */
const moments = clipJobs
  .filter((job) => job.outcome?.status === 'found')
  .flatMap((job) =>
    job.outcome.segments.map((segment, index) => ({
      job,
      segment,
      dir: slug(job.clip.game ?? '', 'unknown-game'),
      name: `${slug(segment.title)}-${job.clipJobId.slice(-6)}-${index + 1}`,
    })),
  )
  .sort((a, b) => b.segment.confidence - a.segment.confidence);
console.log(
  `${clipJobs.length} clips: ${moments.length} moments to cut into ${renderDir}`,
);

const encoder = await resolveEncoder(values.encoder);
let made = 0;
let kept = 0;
await forEachConcurrent(moments, concurrency, async (moment) => {
  moment.file = path.join(moment.dir, `${moment.name}.mp4`);
  try {
    const source = await sourceFor(moment.job.clip);
    moment.fromProxy = source.isProxy;
    // Named for how it was cut, so a different --pad, or the original turning up where only the
    // proxy was before, makes a new cut instead of reusing the old one.
    const name = `${moment.name}${pad ? `-pad${pad}` : ''}${source.isProxy ? '-proxy' : ''}.mp4`;
    moment.file = path.join(moment.dir, name);
    const output = path.join(renderDir, moment.file);
    if (await exists(output)) {
      kept++;
      return;
    }
    await mkdir(path.dirname(output), { recursive: true });
    // Cuts used to go straight in renderDir: move one made then instead of cutting it again.
    const flat = path.join(renderDir, name);
    if (await exists(flat)) {
      await rename(flat, output);
      kept++;
      return;
    }
    await cut(source.file, output, moment.segment);
    made++;
    console.log(`  ✓ ${moment.file}${source.isProxy ? ' (from proxy)' : ''}`);
  } catch (error) {
    moment.error = error instanceof Error ? error.message : String(error);
    console.log(`  ✗ ${moment.file}: ${moment.error}`);
  }
});

const page = path.join(renderDir, 'index.html');
await writeFile(page, html({ runInfo, clipJobs, moments }));
await writeFile(
  path.join(renderDir, 'results.json'),
  JSON.stringify({ run: runInfo, clipJobs }, null, 2),
);
console.log(
  `Cut ${made}${kept ? ` (${kept} were already cut)` : ''}. Open ${page}`,
);

/** sha256 → the original's path, for the latest successful manifest line of each. */
async function readOriginals(file) {
  const originals = new Map();
  const text = await readFile(file, 'utf8').catch(() => '');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (record.status === 'ok')
      originals.set(record.sha256, record.originalPath);
  }
  return originals;
}

/** The original if it's here (by the manifest, then by where the run says it was), else the proxy. */
async function sourceFor(clip) {
  for (const file of [originals.get(clip.sha256), clip.originalPath]) {
    if (file && (await exists(file))) return { file, isProxy: false };
  }
  const proxy = proxyPath(clip.sha256);
  if (await exists(proxy)) return { file: proxy, isProxy: true };
  throw new Error(
    `neither the original nor the proxy of ${clip.sha256} is here`,
  );
}

async function cut(input, output, segment) {
  const { audioTracks, durationSec } = await probe(input);
  const start = Math.max(0, segment.startSec - pad);
  const end = Math.min(durationSec, segment.endSec + pad);
  const partial = output.replace(/\.mp4$/, '') + '.partial.mp4';
  const args = (encoder) => {
    const audio = audioFilter(audioTracks);
    const video = `[0:v:0]${scaleFilter(RENDER.maxWidth, RENDER.maxHeight)},format=yuv420p[v]`;
    // prettier-ignore
    return [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      ...(encoder === 'videotoolbox' ? ['-hwaccel', 'videotoolbox'] : []),
      // Seeking before the input and re-encoding cuts on the exact frame.
      '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', input,
      '-filter_complex', audio ? `${video};${audio}` : video,
      '-map', '[v]',
      ...(audio ? ['-map', '[a]'] : []),
      ...(encoder === 'videotoolbox'
        ? ['-c:v', 'h264_videotoolbox', '-b:v', `${RENDER.videoKbps}k`, '-profile:v', 'high']
        : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']),
      ...(audio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
      '-sn', '-dn', '-map_metadata', '-1',
      '-movflags', '+faststart',
      partial,
    ];
  };
  try {
    try {
      await run(FFMPEG, args(encoder));
    } catch (error) {
      if (encoder !== 'videotoolbox') throw error;
      await run(FFMPEG, args('libx264'));
    }
    await rename(partial, output);
  } finally {
    await rm(partial, { force: true });
  }
}

function proxyPath(sha256) {
  return path.join(outDir, 'proxies', `${sha256}.mp4`);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function slug(title, fallback = 'moment') {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || fallback
  );
}

function html({ runInfo, clipJobs, moments }) {
  const e = escapeHtml;
  const time = (seconds) =>
    `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
  const clipName = (clip) =>
    `${clip.game ? `${e(clip.game)} · ` : ''}${e(path.basename(originals.get(clip.sha256) ?? clip.originalPath))}`;
  const url = (file) => file.split(path.sep).map(encodeURIComponent).join('/');
  const relative = (file) => url(path.relative(renderDir, file));
  const video = (src) =>
    `<video controls preload="metadata" src="${src}"></video>`;

  const notFound = clipJobs.filter(
    (job) => job.outcome?.status === 'not_found',
  );
  const failed = clipJobs.filter((job) => job.state === 'failed');
  const { options } = runInfo;
  const optionsText = Object.entries(options)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    )
    .join(' · ');

  const momentCards = moments
    .map(({ job, segment, file, fromProxy, error }) => {
      const { confidence, category, title, reasoning, startSec, endSec } =
        segment;
      return `<article class="card">
  ${error ? `<p class="error">Couldn't cut it: ${e(error)}</p>` : video(url(file))}
  <h3>${e(title)}</h3>
  <p class="meta"><span class="tag ${e(category)}">${e(category)}</span> ${Math.round(confidence * 100)}% · ${time(startSec)}–${time(endSec)} (${(endSec - startSec).toFixed(1)}s)${fromProxy ? ' · <b>cut from the proxy</b>' : ''}</p>
  <p>${e(reasoning)}</p>
  <p class="file">${clipName(job.clip)}</p>
</article>`;
    })
    .join('\n');

  const proxyCards = (jobs, describe) =>
    jobs
      .map(
        (job) => `<article class="card">
  ${video(relative(proxyPath(job.clip.sha256)))}
  <p>${describe(job)}</p>
  <p class="file">${clipName(job.clip)}</p>
</article>`,
      )
      .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(runInfo.label ?? runId)}</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --card: #fff; --text: #1a1a1a; --muted: #666; --border: #e2e2e2; --error: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111; --card: #1c1c1c; --text: #eee; --muted: #999; --border: #333; --error: #f97066; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, sans-serif; }
  main { max-width: 1400px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h2 { margin: 32px 0 12px; font-size: 18px; }
  h3 { margin: 8px 0 4px; font-size: 16px; }
  p { margin: 4px 0; }
  .summary, .meta, .file { color: var(--muted); font-size: 13px; }
  .file { word-break: break-all; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 16px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  video { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 4px; }
  .tag { display: inline-block; padding: 0 6px; border-radius: 4px; background: var(--border); color: var(--text); }
  .error { color: var(--error); }
</style>
</head>
<body>
<main>
  <h1>${e(runInfo.label ?? 'Run')} <span class="summary">${e(runId)}</span></h1>
  <p class="summary">${e(runInfo.status)} · ${runInfo.counts.done} done, ${runInfo.found} found something, ${runInfo.counts.failed} failed · $${runInfo.spendUsd.toFixed(4)} · prompt v${runInfo.promptVersion}</p>
  <p class="summary">${e(optionsText)}${pad ? ` · cuts padded ${pad}s` : ''}</p>

  <h2>Found (${moments.length} moments, best first)</h2>
  <div class="grid">${momentCards || '<p>None.</p>'}</div>

  <h2>Nothing found (${notFound.length})</h2>
  <p class="summary">The proxies Gemini saw, to check what it missed.</p>
  <div class="grid">${proxyCards(notFound, (job) => e(job.outcome.reason)) || '<p>None.</p>'}</div>

  <h2>Failed (${failed.length})</h2>
  <div class="grid">${proxyCards(failed, (job) => `<span class="error">${e(job.error ?? 'No error saved')}</span>`) || '<p>None.</p>'}</div>
</main>
</body>
</html>
`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
