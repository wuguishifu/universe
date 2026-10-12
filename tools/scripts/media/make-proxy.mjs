#!/usr/bin/env node
// Makes the small copy of one clip that clipper-service sends to Gemini (see PROXY in lib.mjs),
// and prints what it learned about the clip as JSON.
//
// Usage: node tools/scripts/media/make-proxy.mjs <input> <output.mp4> [--encoder auto|videotoolbox|libx264]
//
// Uses ffmpeg and ffprobe from PATH, or FFMPEG_PATH / FFPROBE_PATH.
import { parseArgs } from 'node:util';
import { makeProxy, sha256File } from './lib.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { encoder: { type: 'string', default: 'auto' } },
});
if (positionals.length !== 2 || !positionals[1].endsWith('.mp4')) {
  console.error(
    'usage: make-proxy.mjs <input> <output.mp4> [--encoder auto|videotoolbox|libx264]',
  );
  process.exit(1);
}
const [input, output] = positionals;

try {
  const [sha256, result] = await Promise.all([
    sha256File(input),
    makeProxy(input, output, { encoder: values.encoder }),
  ]);
  console.log(JSON.stringify({ sha256, ...result }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
