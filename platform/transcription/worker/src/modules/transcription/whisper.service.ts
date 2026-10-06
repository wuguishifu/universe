import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import z from 'zod';
import { open, readFile } from 'fs/promises';
import { ProcessError, runProcess } from '@libs/nest-common';
import { EnvironmentService } from '../../environment';

const WHISPER_SAMPLE_RATE = 16_000;

const whisperJsonSchema = z.object({
  result: z.object({ language: z.string() }),
  transcription: z.array(
    z.object({
      offsets: z.object({ from: z.number(), to: z.number() }),
      text: z.string(),
    }),
  ),
});
type WhisperJson = z.infer<typeof whisperJsonSchema>;

@Injectable()
export class WhisperService implements OnModuleDestroy {
  private readonly abortController = new AbortController();

  constructor(private readonly environmentService: EnvironmentService) {}

  onModuleDestroy() {
    this.abortController.abort();
  }

  public async transcribe({
    modelPath,
    wavPath,
    outputBase,
    prompt,
    timeoutMs,
    beamSize = 1,
  }: {
    modelPath: string;
    wavPath: string;
    outputBase: string;
    prompt?: string;
    timeoutMs: number;
    beamSize?: number;
  }): Promise<{ result: WhisperJson; whisperProcessingTimeMs: number }> {
    const startTime = Date.now();

    // prettier-ignore
    await runProcess(
      this.environmentService.environment.whisperCliPath,
      [
        '-m', modelPath,
        '-f', wavPath,
        '-l', 'en',
        '--beam-size', String(beamSize), '--best-of', String(beamSize),
        '--output-json', 'of', outputBase,
        '--no-prints',
        ...(prompt ? ['--prompt', prompt] : []),
      ],
      { timeoutMs, signal: this.abortController.signal }
    );

    return {
      result: whisperJsonSchema.parse(
        JSON.parse(await readFile(`${outputBase}.json`, 'utf-8')),
      ),
      whisperProcessingTimeMs: Date.now() - startTime,
    };
  }

  /** Converts any ffmpeg-readable input to the 16kHz mono WAV whisper needs. Returns its duration. */
  public async prepareRawData({
    inputPath,
    outputPath,
    timeoutMs,
  }: {
    inputPath: string;
    outputPath: string;
    timeoutMs: number;
  }): Promise<{ durationMs: number; ffmpegProcessingTimeMs: number }> {
    const startTime = Date.now();
    try {
      // prettier-ignore
      await runProcess(
        this.environmentService.environment.ffmpegPath,
        [
          '-hide_banner', '-loglevel', 'error',
          '-i', inputPath,
          '-vn', '-ar', String(WHISPER_SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
          '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
          '-y', outputPath,
        ],
        { timeoutMs, signal: this.abortController.signal },
      );
    } catch (error) {
      if (error instanceof ProcessError) {
        throw new UnrecoverableError(
          `Could not decode audio: ${error.stderrTail}`,
        );
      }
      throw error;
    }

    return {
      durationMs: await readWavDurationMs(outputPath),
      ffmpegProcessingTimeMs: Date.now() - startTime,
    };
  }
}

async function readWavDurationMs(wavPath: string): Promise<number> {
  const file = await open(wavPath, 'r');
  try {
    const { size: fileSize } = await file.stat();
    const riff = Buffer.alloc(12);
    await file.read(riff, 0, 12, 0);
    if (
      riff.toString('ascii', 0, 4) !== 'RIFF' ||
      riff.toString('ascii', 8, 12) !== 'WAVE'
    ) {
      throw new Error(`${wavPath} is not a WAV file`);
    }

    let byteRate: number | undefined;
    const chunkHeader = Buffer.alloc(8);
    for (let offset = 12; offset + 8 <= fileSize;) {
      await file.read(chunkHeader, 0, 8, offset);
      const id = chunkHeader.toString('ascii', 0, 4);
      const size = chunkHeader.readUInt32LE(4);
      const bodyOffset = offset + 8;

      if (id === 'fmt ') {
        // fmt layout: format (u16), channels (u16), sample rate (u32), byte rate (u32), ...
        const fmt = Buffer.alloc(12);
        await file.read(fmt, 0, 12, bodyOffset);
        byteRate = fmt.readUInt32LE(8);
      } else if (id === 'data') {
        if (!byteRate) throw new Error(`${wavPath} has no fmt chunk`);
        // A writer that couldn't seek back leaves a placeholder size, so cap it at what's on disk.
        const dataBytes = Math.min(size, fileSize - bodyOffset);
        return Math.round((dataBytes / byteRate) * 1000);
      }

      // Chunk bodies are padded to an even length.
      offset = bodyOffset + size + (size % 2);
    }
    throw new Error(`${wavPath} has no data chunk`);
  } finally {
    await file.close();
  }
}
