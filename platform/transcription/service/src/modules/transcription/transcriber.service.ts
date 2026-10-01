import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { S3ObjectNotFoundError, S3Service } from '@universe/nest-common';
import type { Transcript } from '@universe/platform/transcription/contracts';
import { EnvironmentService } from '../../environment/environment-service';
import type {
  TranscriptionJobData,
  TranscriptionLane,
} from '../../queues/queue';
import { ProcessError, runProcess } from '../../utils/run-process';
import { WhisperModelsService } from './whisper-models.service';

const WHISPER_SAMPLE_RATE = 16_000;
/** 16-bit mono PCM. */
const WHISPER_BYTES_PER_SECOND = WHISPER_SAMPLE_RATE * 2;
const WAV_HEADER_BYTES = 44;

const LANE_LIMITS: Record<TranscriptionLane, { timeoutMs: number }> = {
  interactive: { timeoutMs: 2 * 60 * 1000 },
  batch: { timeoutMs: 3 * 60 * 60 * 1000 },
};

/** The subset of whisper-cli's `--output-json` file we use. */
const whisperJsonSchema = z.object({
  result: z.object({ language: z.string() }),
  transcription: z.array(
    z.object({
      offsets: z.object({ from: z.number(), to: z.number() }),
      text: z.string(),
    }),
  ),
});

/**
 * Worker-side pipeline: any audio → 16kHz mono WAV (ffmpeg) → whisper-cli → transcript.
 * Errors that retrying can't fix (undecodable audio, missing model) are thrown as
 * UnrecoverableError so BullMQ fails the job immediately instead of retrying.
 */
@Injectable()
export class TranscriberService {
  private readonly logger = new Logger(TranscriberService.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly models: WhisperModelsService,
    private readonly s3: S3Service,
  ) {}

  async transcribe(
    { source, options }: TranscriptionJobData,
    lane: TranscriptionLane,
  ): Promise<Transcript> {
    const env = this.environmentService.environment;
    const { timeoutMs } = LANE_LIMITS[lane];
    const { threads, beamSize } =
      lane === 'interactive'
        ? {
            threads: env.whisperThreadsInteractive,
            beamSize: env.whisperBeamSizeInteractive,
          }
        : {
            threads: env.whisperThreadsBatch,
            beamSize: env.whisperBeamSizeBatch,
          };

    // The API resolves the model before queueing; this only guards against config drift.
    const model = this.models.resolve(options.model);
    const modelPath = model && this.models.installedPath(model);
    if (!model || !modelPath) {
      throw new UnrecoverableError(
        `Model "${options.model}" is not installed on this worker`,
      );
    }
    if (options.vad && !this.models.vadModelPath) {
      throw new UnrecoverableError('VAD is not configured on this worker');
    }

    const workDir = await mkdtemp(path.join(tmpdir(), 'tungsten-'));
    try {
      const inputPath = path.join(workDir, 'input');
      if (source.type === 'inline') {
        await writeFile(inputPath, Buffer.from(source.data, 'base64'));
      } else {
        await this.downloadFromS3(source.bucket, source.key, inputPath);
      }

      const wavPath = path.join(workDir, 'audio.wav');
      await this.convertForWhisper(inputPath, wavPath, timeoutMs);
      const audioDurationMs = Math.round(
        (((await stat(wavPath)).size - WAV_HEADER_BYTES) /
          WHISPER_BYTES_PER_SECOND) *
          1000,
      );

      const outputBase = path.join(workDir, 'transcript');
      const startedAt = Date.now();
      // prettier-ignore
      await runProcess(env.whisperCliPath, [
        '-m', modelPath,
        '-f', wavPath,
        '-l', options.language,
        '-t', String(threads),
        // Beam size 1 switches whisper-cli to greedy decoding; best-of matches it.
        '--beam-size', String(beamSize), '--best-of', String(beamSize),
        '--output-json', '-of', outputBase,
        '--no-prints',
        ...(options.prompt ? ['--prompt', options.prompt] : []),
        ...(options.vad && this.models.vadModelPath ? ['--vad', '-vm', this.models.vadModelPath] : []),
      ], { timeoutMs });
      const elapsedMs = Date.now() - startedAt;

      const output = whisperJsonSchema.parse(
        JSON.parse(await readFile(`${outputBase}.json`, 'utf8')),
      );
      const segments = output.transcription.map((segment) => ({
        startMs: segment.offsets.from,
        endMs: segment.offsets.to,
        text: segment.text.trim(),
      }));

      this.logger.log(
        `[${lane}] ${model}: ${audioDurationMs}ms audio in ${elapsedMs}ms ` +
          `(${(elapsedMs / Math.max(audioDurationMs, 1)).toFixed(2)}x realtime)`,
      );

      return {
        text: segments
          .map((segment) => segment.text)
          .filter(Boolean)
          .join(' '),
        segments,
        language: output.result.language,
        model,
        audioDurationMs,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async downloadFromS3(bucket: string, key: string, filePath: string) {
    if (!this.s3.isConfigured) {
      throw new UnrecoverableError(
        'S3 sources are not configured on this worker',
      );
    }
    try {
      await this.s3.downloadToFile(bucket, key, filePath);
    } catch (error) {
      // A missing object won't appear on retry; other S3 errors might be transient.
      if (error instanceof S3ObjectNotFoundError) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }

  private async convertForWhisper(
    inputPath: string,
    outputPath: string,
    timeoutMs: number,
  ) {
    try {
      // prettier-ignore
      await runProcess(this.environmentService.environment.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-i', inputPath,
        '-vn', '-ar', String(WHISPER_SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
        // No metadata chunks, so the WAV header is exactly 44 bytes (used for the duration).
        '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact',
        '-y', outputPath,
      ], { timeoutMs });
    } catch (error) {
      if (error instanceof ProcessError) {
        throw new UnrecoverableError(
          `Could not decode audio: ${error.stderrTail}`,
        );
      }
      throw error;
    }
  }
}
