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
  type TranscriptSegment,
} from '@platform/transcription-contracts';
import { DiarizerService } from './diarizer.service';
import { FilesService } from './files.service';
import { ModelsService } from './models.service';
import { assignSpeakers, segmentsBySpeaker } from './speakers';
import { WhisperService } from './whisper.service';
import { tokensToWords } from './words';

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

@UniverseProcessor(TRANSCRIPTION_QUEUE_CONFIG, 'transcribe')
export class TranscriptionProcessor extends WorkerHost {
  constructor(
    private readonly filesService: FilesService,
    private readonly modelsService: ModelsService,
    private readonly whisperService: WhisperService,
    private readonly diarizerService: DiarizerService,
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
    const diarize = options?.diarize;
    if (diarize && !this.diarizerService.available) {
      throw new UnrecoverableError('This worker has no diarizer');
    }
    // Speakers are matched to words, so diarizing needs word timings.
    const wordTimestamps = !!(options?.wordTimestamps || diarize);

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

      // if we're transcribing at 3x real time that's a bit wack
      const timeoutMs = Math.max(DEFAULT_TIMEOUT_MS, durationMs * 3);
      // Both only read the WAV, so they run at the same time.
      const [
        {
          result: { transcription, result },
          whisperProcessingTimeMs,
        },
        diarization,
      ] = await Promise.all([
        this.whisperService.transcribe({
          model,
          modelPath,
          wavPath,
          outputBase: path.join(workDir, 'transcript'),
          prompt: options?.prompt,
          beamSize: options?.beamSize,
          wordTimestamps,
          timeoutMs,
        }),
        diarize
          ? this.diarizerService.diarize({
              wavPath,
              outputPath: path.join(workDir, 'speakers.json'),
              minSpeakers: diarize.minSpeakers,
              maxSpeakers: diarize.maxSpeakers,
              timeoutMs,
            })
          : undefined,
      ]);

      let segments: TranscriptSegment[] = transcription.map((segment) => ({
        startMs: segment.offsets.from,
        endMs: segment.offsets.to,
        text: segment.text.trim(),
      }));
      let words = wordTimestamps
        ? tokensToWords(transcription.flatMap((segment) => segment.tokens))
        : undefined;
      if (diarization && words) {
        words = assignSpeakers(words, diarization.turns);
        segments = segmentsBySpeaker(words);
      }

      return {
        transcript: {
          text: segments
            .map(({ text }) => text)
            .filter(Boolean)
            .join(' '),
          segments,
          words,
          language: result.language,
          model,
          audioDurationMs: durationMs,
        },
        analytics: {
          waitTimeMs: (job.processedOn ?? Date.now()) - job.timestamp,
          ffmpegProcessingTimeMs,
          whisperProcessingTimeMs,
          diarizeProcessingTimeMs: diarization?.diarizeProcessingTimeMs,
          audioDurationMs: durationMs,
          realtimeFactor: whisperProcessingTimeMs / durationMs,
        },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
