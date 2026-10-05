import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { findPhraseMatches, type PhraseMatch } from '@libs/phrase-matching';
import { TrackingService } from '@platform/analytics-client-nest';
import {
  JANKBOT_QUEUE_CONFIG,
  type JankbotQueueJob,
  OPUS_FRAME_MS,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';
import { TranscriptionClientService } from '../common/transcription-client.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { TrackedWordsService } from '../tracked-words/tracked-words.service';
import { decodeOpusPackets, loudMs, pcmToWav } from './audio';
import { vocabularyPrompt } from './vocabulary-prompt';

type UtteranceResult = { transcript: string; matches: PhraseMatch[] };

// Transcription happens in transcription-service, so jobs here mostly wait on HTTP; transcription-service serializes the
// heavy work itself, so a few concurrent jobs just keep its queue fed.
@Processor(JANKBOT_QUEUE_CONFIG.utterances.queueName, { concurrency: 4 })
export class UtteranceProcessor extends WorkerHost {
  private readonly logger = new Logger(UtteranceProcessor.name);

  constructor(
    private readonly transcriptionClient: TranscriptionClientService,
    private readonly trackedWords: TrackedWordsService,
    private readonly leaderboard: LeaderboardService,
    private readonly environmentService: EnvironmentService,
    private readonly trackingService: TrackingService,
  ) {
    super();
  }

  // BullMQ swallows processing errors (it just retries, then marks the job failed), so log them.
  @OnWorkerEvent('failed')
  onFailed(job: JankbotQueueJob<'utterances'> | undefined, error: Error) {
    // fetch's "fetch failed" hides the real reason (e.g. ECONNREFUSED) in `cause`.
    const reason =
      error.cause instanceof Error
        ? `${error.message}: ${error.cause.message}`
        : error.message;
    if (!job) {
      this.logger.error(`Utterance job failed: ${reason}`);
      return;
    }
    const { guildId, userId } = job.data;
    const attempts = job.opts.attempts ?? 1;
    const final =
      error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    const message = `[${guildId}] ${userId}: attempt ${job.attemptsMade}/${attempts} failed: ${reason}`;
    if (final) {
      this.logger.error(`${message} (giving up)`);
    } else {
      this.logger.warn(`${message} (will retry)`);
    }
  }

  private trackTranscription(
    utteranceId: string,
    userId: string,
    durationMs: number,
    transcription?: string,
    transcriptDurationMs?: number,
  ) {
    this.trackingService.trackEvent({
      name: 'external_transcription-finished',
      properties: {
        userId,
        reconciliationId: utteranceId,
      },
      extra: {
        durationMs,
        transcription,
        transcriptDurationMs,
      },
    });
  }

  override async process(
    job: JankbotQueueJob<'utterances'>,
  ): Promise<UtteranceResult> {
    const { utteranceId, guildId, userId, opusPackets } = job.data;

    const pcm = await decodeOpusPackets(
      opusPackets.map((packet) => Buffer.from(packet, 'base64')),
    );

    // The gateway's UTTERANCE_MIN_MS measures how long Discord transmitted, so a mic tick can pass it
    // while holding almost no sound, which whisper just turns into [BLANK_AUDIO].
    const { utteranceMinLoudMs, utteranceLoudnessThresholdDbfs } =
      this.environmentService.environment;
    const loud = loudMs(pcm, utteranceLoudnessThresholdDbfs);
    if (loud < utteranceMinLoudMs) {
      this.logger.debug(
        `[${guildId}] ${userId}: skipped, ${loud}ms loud of ${opusPackets.length * OPUS_FRAME_MS}ms`,
      );
      return { transcript: '', matches: [] };
    }

    // Fetched before transcribing so whisper can be prompted with the guild's phrases; otherwise
    // it mangles made-up words (e.g. "cosclaire" → "cause clair") and they never match.
    const phrases = await this.trackedWords.list(guildId);
    const externalTranscriptionStart = Date.now();
    const response = await this.transcriptionClient.transcribe(
      pcmToWav(pcm),
      utteranceId,
      vocabularyPrompt(phrases),
    );
    const externalTranscriptionDurationMs =
      Date.now() - externalTranscriptionStart;

    switch (response.status) {
      case 200:
        break;
      case 422:
        // transcription-service couldn't transcribe this audio; retrying won't change that.
        this.logger.warn(`[${guildId}] ${userId}: ${response.body.message}`);
        this.trackTranscription(
          utteranceId,
          userId,
          externalTranscriptionDurationMs,
        );
        return { transcript: '', matches: [] };
      case 400:
        // A request transcription-service rejects is a configuration problem (e.g. an unknown model).
        this.trackTranscription(
          utteranceId,
          userId,
          externalTranscriptionDurationMs,
        );
        throw new UnrecoverableError(
          `transcription-service: ${response.body.message}`,
        );
      default:
        // 504 (still transcribing), 401, 5xx: retry. The idempotency key reattaches to the
        // original transcription instead of starting a new one.
        this.trackTranscription(
          utteranceId,
          userId,
          externalTranscriptionDurationMs,
        );
        throw new Error(`transcription-service responded ${response.status}`);
    }

    const transcript = response.body.text;
    this.trackTranscription(
      utteranceId,
      userId,
      externalTranscriptionDurationMs,
      transcript,
      loud,
    );

    this.logger.debug(
      `[${guildId}] ${userId} (${loud}ms loud): "${transcript}"`,
    );
    if (!transcript) return { transcript, matches: [] };

    const matches = findPhraseMatches(transcript, phrases);
    if (matches.length > 0) {
      await this.leaderboard.recordMatches(guildId, userId, matches);
      this.trackingService.trackEvent({
        name: 'utterance_processor-phrase-matched',
        properties: {
          userId,
          reconciliationId: utteranceId,
        },
        extra: {
          transcript,
          matches,
        },
      });
      this.logger.log(
        `[${guildId}] ${userId} said ${matches.map((m) => `"${m.phrase}" x${m.count}`).join(', ')}`,
      );
    }

    return { transcript, matches };
  }
}
