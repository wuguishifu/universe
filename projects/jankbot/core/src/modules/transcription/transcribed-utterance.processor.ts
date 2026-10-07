import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { findPhraseMatches } from '@libs/phrase-matching';
import { TrackingService } from '@platform/analytics-client-nest';
import {
  TranscriptionClient,
  TranscriptionFailedError,
  type TranscriptionResult,
} from '@platform/transcription-client-nest';
import {
  JANKBOT_QUEUE_CONFIG,
  type JankbotJobData,
  type JankbotQueueJob,
} from '@projects/jankbot-contracts';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { TrackedWordsService } from '../tracked-words/tracked-words.service';
import { logJobFailure } from './log-job-failure';

/** Matches tracked phrases in an utterance's transcript, once the transcription worker is done. */
@Processor(JANKBOT_QUEUE_CONFIG.transcribedUtterances.queueName, {
  concurrency: 4,
})
export class TranscribedUtteranceProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscribedUtteranceProcessor.name);

  constructor(
    private readonly transcription: TranscriptionClient,
    private readonly trackedWords: TrackedWordsService,
    private readonly leaderboard: LeaderboardService,
    private readonly trackingService: TrackingService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(
    job: JankbotQueueJob<'transcribedUtterances'> | undefined,
    error: Error,
  ) {
    logJobFailure(this.logger, job, error);
  }

  override async process(
    job: JankbotQueueJob<'transcribedUtterances'>,
  ): Promise<void> {
    const { utteranceId, guildId, userId, loudMs } = job.data;

    let result: TranscriptionResult;
    try {
      result = await this.transcription.getResult(job);
    } catch (error) {
      if (!(error instanceof TranscriptionFailedError)) throw error;
      // The worker gave up on this audio; retrying here would just read the same failure.
      this.logger.warn(`[${guildId}] ${userId}: ${error.message}`);
      this.trackTranscription(job.data);
      return;
    }

    const transcript = result.transcript.text;
    this.trackTranscription(job.data, result);
    this.logger.debug(
      `[${guildId}] ${userId} (${loudMs}ms loud): "${transcript}"`,
    );
    if (!transcript) return;

    const phrases = await this.trackedWords.list(guildId);
    const matches = findPhraseMatches(transcript, phrases);
    if (matches.length === 0) return;

    await this.leaderboard.recordMatches(guildId, userId, matches);
    this.trackingService.trackEvent({
      name: 'utterance_processor-phrase-matched',
      properties: { userId, reconciliationId: utteranceId },
      extra: { transcript, matches },
    });
    this.logger.log(
      `[${guildId}] ${userId} said ${matches.map((m) => `"${m.phrase}" x${m.count}`).join(', ')}`,
    );
  }

  /** `result` is missing when the transcription failed. */
  private trackTranscription(
    {
      utteranceId,
      userId,
      queuedAt,
      loudMs,
    }: JankbotJobData<'transcribedUtterances'>,
    result?: TranscriptionResult,
  ) {
    this.trackingService.trackEvent({
      name: 'external_transcription-finished',
      properties: { userId, reconciliationId: utteranceId },
      extra: {
        // From queueing the transcription to its result reaching core.
        durationMs: Date.now() - queuedAt,
        transcription: result?.transcript.text,
        transcriptDurationMs: loudMs,
        ...result?.analytics,
      },
    });
  }
}
