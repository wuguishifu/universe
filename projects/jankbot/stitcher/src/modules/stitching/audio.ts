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

/**
 * Pads each clip (whisper's timings are rough, and a clip cut right at a word clips it), clamps it
 * to the audio, and merges clips that then overlap, so audio is never played twice: two
 * occurrences in the same whisper segment have identical clips.
 */
export function prepareClips(
  clips: readonly ClipRange[],
  durationMs: number,
  { padBeforeMs, padAfterMs }: { padBeforeMs: number; padAfterMs: number },
): ClipRange[] {
  const padded = clips
    .map(({ startMs, endMs }) => ({
      startMs: Math.max(0, startMs - padBeforeMs),
      endMs: Math.min(durationMs, endMs + padAfterMs),
    }))
    .filter(({ startMs, endMs }) => endMs > startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: ClipRange[] = [];
  for (const clip of padded) {
    const last = merged[merged.length - 1];
    if (last && clip.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, clip.endMs);
    } else {
      merged.push({ ...clip });
    }
  }
  return merged;
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
