import { opus } from 'prism-media';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { OPUS_FRAME_MS } from '@projects/jankbot-contracts';

/** whisper's input format. Opus can decode straight to it, so no resampling is needed. */
const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;

/**
 * Decodes Discord Opus packets (48kHz stereo) to a 16kHz mono 16-bit WAV: the format whisper
 * uses, so transcription-service's ffmpeg step is a pass-through. ~32KB per second of audio.
 */
export async function opusPacketsToWav(packets: Buffer[]): Promise<Buffer> {
  const decoder = new opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: (SAMPLE_RATE * OPUS_FRAME_MS) / 1000,
  });
  const chunks: Buffer[] = [];

  // Readable.from yields each packet as its own chunk, which is what the decoder expects.
  await pipeline(Readable.from(packets), decoder, async (pcm) => {
    for await (const chunk of pcm) {
      if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    }
  });

  const data = Buffer.concat(chunks);
  return Buffer.concat([wavHeader(data.length), data]);
}

function wavHeader(dataBytes: number): Buffer {
  const header = Buffer.alloc(44);
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
