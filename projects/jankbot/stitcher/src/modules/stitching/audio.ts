/** The format core uploads utterances in (its pcmToWav): 16kHz mono 16-bit PCM. */
export const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

/** A span of an utterance's audio, in ms from its start. */
export interface ClipRange {
  startMs: number;
  endMs: number;
}

/**
 * The PCM in a WAV that core uploaded. Walks the chunks rather than assuming a 44-byte header, and
 * throws on any other format, since slicing by sample offsets depends on it.
 */
export function readWavPcm(wav: Buffer): Buffer {
  if (
    wav.length < 12 ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Not a WAV file');
  }

  let formatChecked = false;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === 'fmt ') {
      const format = wav.readUInt16LE(body);
      const channels = wav.readUInt16LE(body + 2);
      const sampleRate = wav.readUInt32LE(body + 4);
      const bitsPerSample = wav.readUInt16LE(body + 14);
      if (
        format !== 1 ||
        channels !== CHANNELS ||
        sampleRate !== SAMPLE_RATE ||
        bitsPerSample !== BITS_PER_SAMPLE
      ) {
        throw new Error(
          `Expected ${SAMPLE_RATE}Hz mono 16-bit PCM, got format ${format}, ${channels}ch, ${sampleRate}Hz, ${bitsPerSample}-bit`,
        );
      }
      formatChecked = true;
    } else if (id === 'data') {
      if (!formatChecked) throw new Error('WAV has no fmt chunk before data');
      // Cap at what's there, in case the header's size is a placeholder.
      return wav.subarray(body, Math.min(body + size, wav.length));
    }

    // Chunks are padded to an even size.
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

export function pcmDurationMs(pcm: Buffer): number {
  return (pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000;
}

/** Loudness is measured over 20ms frames, like core's loudMs. */
const FRAME_MS = 20;
const FRAME_BYTES = ((SAMPLE_RATE * FRAME_MS) / 1000) * BYTES_PER_SAMPLE;
/** A frame this far below the speaker's speech level counts as quiet. */
const QUIET_BELOW_SPEECH_DB = 25;
/**
 * Quiet stretches shorter than this inside speech are part of a word, not a pause: e.g. the
 * closure before the "k" in "mikey", which is silent for a frame or two.
 */
const MIN_PAUSE_FRAMES = 3;
/** Louder stretches shorter than this are clicks and breaths, not speech. */
const MIN_SPEECH_FRAMES = 4;

export interface SnapOptions {
  /** How far before whisper's start to look for where the speech starts. */
  searchBeforeMs: number;
  /** How far after whisper's end to look for where the speech ends. */
  searchAfterMs: number;
}

/**
 * Moves each clip's edges to where the speech around whisper's timing starts and stops, since its
 * word timings are often a little off (usually late), which cuts the phrase off mid-sound or
 * misses a short word entirely:
 * - an edge mid-speech moves out to the nearest pause (or the quietest point, if speech runs on),
 * - an edge in silence moves in to the speech,
 * - a clip that's all silence just after someone spoke is taken to be a late timing, and moved
 *   back onto the end of that speech.
 * Clips with no speech in reach are dropped, and clips that overlap are merged, so audio is never
 * played twice.
 */
export function prepareClips(
  clips: readonly ClipRange[],
  pcm: Buffer,
  { searchBeforeMs, searchAfterMs }: SnapOptions,
): ClipRange[] {
  const levels = frameLevels(pcm);
  if (levels.length === 0) return [];
  // Relative to how loud this speaker is, since mic gain and background noise vary a lot.
  const speech = speechMask(
    levels,
    percentile(levels, 0.9) - QUIET_BELOW_SPEECH_DB,
  );
  const lastFrame = levels.length - 1;
  const searchBefore = Math.ceil(searchBeforeMs / FRAME_MS);
  const searchAfter = Math.ceil(searchAfterMs / FRAME_MS);

  const snapped = clips
    .flatMap(({ startMs, endMs }) => {
      let from = clamp(Math.floor(startMs / FRAME_MS), 0, lastFrame);
      let to = clamp(Math.ceil(endMs / FRAME_MS) - 1, from, lastFrame);

      if (!speech.slice(from, to + 1).includes(true)) {
        const speechEnd = speech.lastIndexOf(true, from);
        if (speechEnd < 0 || from - speechEnd > searchBefore) return [];
        const length = to - from;
        to = speechEnd;
        from = Math.max(0, speechEnd - length);
      }

      let start = from;
      if (speech[start]) {
        const limit = Math.max(0, from - searchBefore);
        while (start > limit && speech[start - 1]) start--;
        if (start === limit && speech[limit])
          start = quietest(levels, limit, from);
      } else {
        while (!speech[start]) start++;
      }

      let end = to;
      if (speech[end]) {
        const limit = Math.min(lastFrame, to + searchAfter);
        while (end < limit && speech[end + 1]) end++;
        if (end === limit && speech[limit]) end = quietest(levels, to, limit);
      } else {
        while (!speech[end]) end--;
      }

      // A frame of lead-in and -out, so the fades don't eat into the speech.
      return [
        {
          startMs: Math.max(0, start - 1) * FRAME_MS,
          endMs: (Math.min(lastFrame, end + 1) + 1) * FRAME_MS,
        },
      ];
    })
    .sort((a, b) => a.startMs - b.startMs);

  const merged: ClipRange[] = [];
  for (const clip of snapped) {
    const last = merged[merged.length - 1];
    if (last && clip.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, clip.endMs);
    } else {
      merged.push({ ...clip });
    }
  }
  return merged;
}

/** Which frames are speech: loud ones, with pauses inside words filled and blips removed. */
function speechMask(levels: readonly number[], quietDbfs: number): boolean[] {
  const mask = levels.map((level) => level >= quietDbfs);
  for (const [start, end] of runs(mask, false)) {
    const enclosed = start > 0 && end < mask.length;
    if (enclosed && end - start < MIN_PAUSE_FRAMES) mask.fill(true, start, end);
  }
  for (const [start, end] of runs(mask, true)) {
    if (end - start < MIN_SPEECH_FRAMES) mask.fill(false, start, end);
  }
  return mask;
}

/** [start, end) of each run of `value`. */
function runs(mask: readonly boolean[], value: boolean): [number, number][] {
  const found: [number, number][] = [];
  for (let start = 0; start < mask.length;) {
    if (mask[start] !== value) {
      start++;
      continue;
    }
    let end = start;
    while (end < mask.length && mask[end] === value) end++;
    found.push([start, end]);
    start = end;
  }
  return found;
}

/** The quietest frame in [from, to], the least bad place to cut speech that doesn't pause. */
function quietest(levels: readonly number[], from: number, to: number): number {
  let best = from;
  for (let frame = from; frame <= to; frame++) {
    if ((levels[frame] ?? 0) < (levels[best] ?? 0)) best = frame;
  }
  return best;
}

/** Each whole 20ms frame's RMS level, in dBFS. */
function frameLevels(pcm: Buffer): number[] {
  const levels: number[] = [];
  for (let start = 0; start + FRAME_BYTES <= pcm.length; start += FRAME_BYTES) {
    let sumSquares = 0;
    for (
      let offset = start;
      offset < start + FRAME_BYTES;
      offset += BYTES_PER_SAMPLE
    ) {
      const sample = pcm.readInt16LE(offset);
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / (FRAME_BYTES / BYTES_PER_SAMPLE));
    levels.push(20 * Math.log10(Math.max(rms, 1) / 32768));
  }
  return levels;
}

/** How loud speech should end up, in dBFS (measured like QUIET_BELOW_SPEECH_DB's speech level). */
const TARGET_SPEECH_DBFS = -18;
/** So a clip that's mostly noise isn't blown up into loud hiss. */
const MAX_GAIN_DB = 15;
const MIN_GAIN_DB = -12;
/** Peaks stay below this, so boosting never clips. */
const PEAK_LIMIT = 0.9 * 32767;

/**
 * Brings the clip's speech to the same level as every other clip, since people's mics differ by
 * 10dB or more. The gain is capped, and lowered if it would push a peak past the limit.
 */
export function normalizeLoudness(clip: Buffer): Buffer {
  const levels = frameLevels(clip);
  if (levels.length === 0) return clip;

  let peak = 1;
  for (let offset = 0; offset < clip.length; offset += BYTES_PER_SAMPLE) {
    peak = Math.max(peak, Math.abs(clip.readInt16LE(offset)));
  }
  const gainDb = clamp(
    TARGET_SPEECH_DBFS - percentile(levels, 0.9),
    MIN_GAIN_DB,
    MAX_GAIN_DB,
  );
  const gain = Math.min(10 ** (gainDb / 20), PEAK_LIMIT / peak);

  const out = Buffer.alloc(clip.length);
  for (let offset = 0; offset < clip.length; offset += BYTES_PER_SAMPLE) {
    out.writeInt16LE(
      clamp(Math.round(clip.readInt16LE(offset) * gain), -32768, 32767),
      offset,
    );
  }
  return out;
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A copy of the clip's samples, faded in and out over `fadeMs` so the cuts don't click. */
export function slicePcm(
  pcm: Buffer,
  { startMs, endMs }: ClipRange,
  fadeMs: number,
): Buffer {
  const clip = Buffer.from(
    pcm.subarray(msToByteOffset(startMs), msToByteOffset(endMs)),
  );
  const samples = clip.length / BYTES_PER_SAMPLE;
  const fadeSamples = Math.min(
    Math.round((SAMPLE_RATE * fadeMs) / 1000),
    Math.floor(samples / 2),
  );
  for (let i = 0; i < fadeSamples; i++) {
    const gain = i / fadeSamples;
    const head = i * BYTES_PER_SAMPLE;
    const tail = (samples - 1 - i) * BYTES_PER_SAMPLE;
    clip.writeInt16LE(Math.round(clip.readInt16LE(head) * gain), head);
    clip.writeInt16LE(Math.round(clip.readInt16LE(tail) * gain), tail);
  }
  return clip;
}

export function silence(ms: number): Buffer {
  return Buffer.alloc(msToByteOffset(ms));
}

/** Joins the clips with `gapMs` of silence between them. */
export function joinWithGaps(clips: readonly Buffer[], gapMs: number): Buffer {
  const gap = silence(gapMs);
  return Buffer.concat(
    clips.flatMap((clip, i) => (i === 0 ? [clip] : [gap, clip])),
  );
}

/** Rounded down to a whole sample, so slices never split one. */
function msToByteOffset(ms: number): number {
  return Math.floor((ms * SAMPLE_RATE) / 1000) * BYTES_PER_SAMPLE;
}
