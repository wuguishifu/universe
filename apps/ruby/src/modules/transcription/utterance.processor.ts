import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { findPhraseMatches, type PhraseMatch } from '@universe/phrase-matching';
import { RUBY_QUEUE_CONFIG, type RubyQueueJob } from '../../queues/queue';
import { TungstenService } from '../common/tungsten.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { TrackedWordsService } from '../tracked-words/tracked-words.service';
import { opusPacketsToWav } from './audio';

type UtteranceResult = { transcript: string; matches: PhraseMatch[] };

// Transcription happens in tungsten, so jobs here mostly wait on HTTP; tungsten serializes the
// heavy work itself, so a few concurrent jobs just keep its queue fed.
@Processor(RUBY_QUEUE_CONFIG.utterances.queueName, { concurrency: 4 })
export class UtteranceProcessor extends WorkerHost {
  private readonly logger = new Logger(UtteranceProcessor.name);

  constructor(
    private readonly tungsten: TungstenService,
    private readonly trackedWords: TrackedWordsService,
    private readonly leaderboard: LeaderboardService,
  ) {
    super();
  }

  // BullMQ swallows processing errors (it just retries, then marks the job failed), so log them.
  @OnWorkerEvent('failed')
  onFailed(job: RubyQueueJob<'utterances'> | undefined, error: Error) {
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

  override async process(
    job: RubyQueueJob<'utterances'>,
  ): Promise<UtteranceResult> {
    const { utteranceId, guildId, userId, opusPackets } = job.data;

    const wav = await opusPacketsToWav(
      opusPackets.map((packet) => Buffer.from(packet, 'base64')),
    );
    const response = await this.tungsten.transcribe(wav, utteranceId);

    switch (response.status) {
      case 200:
        break;
      case 422:
        // Tungsten couldn't transcribe this audio; retrying won't change that.
        this.logger.warn(`[${guildId}] ${userId}: ${response.body.message}`);
        return { transcript: '', matches: [] };
      case 400:
        // A request tungsten rejects is a configuration problem (e.g. an unknown model).
        throw new UnrecoverableError(`tungsten: ${response.body.message}`);
      default:
        // 504 (still transcribing), 401, 5xx: retry. The idempotency key reattaches to the
        // original transcription instead of starting a new one.
        throw new Error(`tungsten responded ${response.status}`);
    }

    const transcript = response.body.text;
    this.logger.debug(`[${guildId}] ${userId}: "${transcript}"`);
    if (!transcript) return { transcript, matches: [] };

    const phrases = await this.trackedWords.list(guildId);
    const matches = findPhraseMatches(transcript, phrases);
    if (matches.length > 0) {
      await this.leaderboard.recordMatches(guildId, userId, matches);
      this.logger.log(
        `[${guildId}] ${userId} said ${matches.map((m) => `"${m.phrase}" x${m.count}`).join(', ')}`,
      );
    }

    return { transcript, matches };
  }
}
