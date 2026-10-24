import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import z from 'zod';
import { open, readFile } from 'fs/promises';
import { ProcessError, runProcess } from '@libs/nest-common';
import { EnvironmentService } from '../../config/environment';

const WHISPER_SAMPLE_RATE = 16_000;

const whisperJsonSchema = z.object({
  result: z.object({ language: z.string() }),
  transcription: z.array(
    z.object({
      offsets: z.object({ from: z.number(), to: z.number() }),
      text: z.string(),
      /** From --output-json-full. */
      tokens: z
        .array(
          z.object({
            text: z.string(),
            offsets: z.object({ from: z.number(), to: z.number() }),
            /** With --dtw: when the token starts, in 10ms units; -1 without. */
            t_dtw: z.number().default(-1),
          }),
        )
        .default([]),
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
    model,
    modelPath,
    wavPath,
    outputBase,
    prompt,
    timeoutMs,
    beamSize = 1,
    wordTimestamps = false,
    signal,
  }: {
    model: string;
    modelPath: string;
    wavPath: string;
    outputBase: string;
    prompt?: string;
    timeoutMs: number;
    beamSize?: number;
    /** Per-token timings in the JSON (`tokens`), which takes extra decoding work. */
    wordTimestamps?: boolean;
    /** Kills whisper, e.g. when the job fails elsewhere. */
    signal?: AbortSignal;
  }): Promise<{ result: WhisperJson; whisperProcessingTimeMs: number }> {
    const startTime = Date.now();
    const dtwPreset = wordTimestamps ? dtwPresetFor(model) : undefined;
    const abortSignal = signal
      ? AbortSignal.any([this.abortController.signal, signal])
      : this.abortController.signal;

    // prettier-ignore
    await runProcess(
      this.environmentService.environment.whisperCliPath,
      [
        '-m', modelPath,
        '-f', wavPath,
        '-l', 'en',
        '--beam-size', String(beamSize), '--best-of', String(beamSize),
        // Full JSON includes each token's timing, which the transcript's words come from.
        wordTimestamps ? '--output-json-full' : '--output-json', '-of', outputBase,
        // DTW times tokens far more accurately than whisper's default guess, which is often a word
        // off. whisper.cpp silently skips it with flash attention on, so that's turned off (~15% slower).
        ...(dtwPreset ? ['--dtw', dtwPreset, '--no-flash-attn'] : []),
        '--no-prints',
        ...(prompt ? ['--prompt', prompt] : []),
      ],
      { timeoutMs, signal: abortSignal },
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

/** whisper.cpp's --dtw presets: the models it knows the alignment heads of. */
const DTW_PRESETS = new Set([
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'medium.en',
  'large.v1',
  'large.v2',
  'large.v3',
  'large.v3.turbo',
]);

/**
 * The --dtw preset for a model (WHISPER_MODELS names its ggml-<model>.bin file), e.g.
 * "large-v3-turbo-q5_0" → "large.v3.turbo". Quantizing doesn't move the alignment heads.
 */
export function dtwPresetFor(model: string): string | undefined {
  const preset = model.replace(/-q\d.*$/, '').replaceAll('-', '.');
  return DTW_PRESETS.has(preset) ? preset : undefined;
}
