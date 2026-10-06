import { WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { UniverseProcessor } from '@libs/queue';
import {
  TRANSCRIPTION_QUEUE_CONFIG,
  TranscriptionJob,
  TranscriptionJobResult,
} from '@platform/transcription-contracts';
import { FilesService } from './files.service';
import { ModelsService } from './models.service';
import { WhisperService } from './whisper.service';

const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

@UniverseProcessor(TRANSCRIPTION_QUEUE_CONFIG, 'transcribe')
export class TranscriptionProcessor extends WorkerHost {
  constructor(
    private readonly filesService: FilesService,
    private readonly modelsService: ModelsService,
    private readonly whisperService: WhisperService,
  ) {
    super();
  }

  override async process(
    job: TranscriptionJob<'transcribe'>,
  ): Promise<TranscriptionJobResult<'transcribe'>> {
    const { source, options } = job.data;

    const resolvedModel = this.modelsService.resolveModel(options?.model);
    if (!resolvedModel) {
      throw new UnrecoverableError(
        `${options?.model ?? 'default model'} is not installed on this worker`,
      );
    }
    const { model, modelPath } = resolvedModel;

    const workDir = await mkdtemp(path.join(tmpdir(), 'transcription-worker-'));
    try {
      const sourcePath = path.join(workDir, 'source');
      await this.filesService.downloadJobFile(source, sourcePath);

      const wavPath = path.join(workDir, 'audio.wav');
      const { durationMs, ffmpegProcessingTimeMs } =
        await this.whisperService.prepareRawData({
          inputPath: sourcePath,
          outputPath: wavPath,
          timeoutMs: DEFAULT_TIMEOUT_MS,
        });

      const outputBase = path.join(workDir, 'transcript');
      const {
        result: { transcription, result },
        whisperProcessingTimeMs,
      } = await this.whisperService.transcribe({
        modelPath,
        wavPath,
        outputBase,
        prompt: options?.prompt,
        beamSize: options?.beamSize,
        // if we're transcribing at 3x real time that's a bit wack
        timeoutMs: Math.max(DEFAULT_TIMEOUT_MS, durationMs * 3),
      });

      const segments = transcription.map((segment) => ({
        startMs: segment.offsets.from,
        endMs: segment.offsets.to,
        text: segment.text.trim(),
      }));

      return {
        transcript: {
          text: segments
            .map(({ text }) => text)
            .filter(Boolean)
            .join(' '),
          segments,
          language: result.language,
          model,
          audioDurationMs: durationMs,
        },
        analytics: {
          waitTimeMs: (job.processedOn ?? Date.now()) - job.timestamp,
          ffmpegProcessingTimeMs,
          whisperProcessingTimeMs,
          audioDurationMs: durationMs,
          realtimeFactor: whisperProcessingTimeMs / durationMs,
        },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
