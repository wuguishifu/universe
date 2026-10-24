import { opus } from 'prism-media';

import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { OPUS_FRAME_MS, UTTERANCE_WAV } from '@projects/jankbot-contracts';

/**
 * whisper's input format. Opus can decode straight to it, so no resampling is needed. Also what's
 * uploaded for the stitcher, which reads parts of the WAV directly.
 */
const {
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  bytesPerSample: BYTES_PER_SAMPLE,
} = UTTERANCE_WAV;

/** Samples per OPUS_FRAME_MS frame, the window loudness is measured over. */
const SAMPLES_PER_FRAME = (SAMPLE_RATE * OPUS_FRAME_MS) / 1000;
/** Full scale for 16-bit samples, the 0 in dBFS. */
const FULL_SCALE = 32_768;

/**
 * Decodes Discord Opus packets (48kHz stereo) to 16kHz mono 16-bit PCM: the format whisper uses,
 * so transcription-service's ffmpeg step is a pass-through. ~32KB per second of audio.
 */
export async function decodeOpusPackets(packets: Buffer[]): Promise<Buffer> {
  const decoder = new opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: SAMPLES_PER_FRAME,
  });
  const chunks: Buffer[] = [];

  // Readable.from yields each packet as its own chunk, which is what the decoder expects.
  await pipeline(Readable.from(packets), decoder, async (pcm) => {
    for await (const chunk of pcm) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    }
  });

  return Buffer.concat(chunks);
}

/** Wraps PCM from decodeOpusPackets in a WAV header. */
export function pcmToWav(pcm: Buffer): Buffer {
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}

/**
 * How much of the PCM from decodeOpusPackets is louder than `thresholdDbfs`, in ms: the number of
 * OPUS_FRAME_MS frames whose RMS level is above it. Mic ticks and background hiss come out near 0
 * even when Discord transmitted for a while.
 */
export function loudMs(pcm: Buffer, thresholdDbfs: number): number {
  // Compare mean squares rather than taking a log per frame.
  const threshold = FULL_SCALE * 10 ** (thresholdDbfs / 20);
  const thresholdSquared = threshold * threshold;
  const frameBytes = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE;

  let loudFrames = 0;
  for (let start = 0; start + frameBytes <= pcm.length; start += frameBytes) {
    let sumSquares = 0;
    for (let offset = start; offset < start + frameBytes; offset += 2) {
      const sample = pcm.readInt16LE(offset);
      sumSquares += sample * sample;
    }
    if (sumSquares / SAMPLES_PER_FRAME > thresholdSquared) loudFrames++;
  }
  return loudFrames * OPUS_FRAME_MS;
}

function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(UTTERANCE_WAV.headerBytes);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}
