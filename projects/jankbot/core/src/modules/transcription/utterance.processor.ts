import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { TranscriptionClient } from '@platform/transcription-client-nest';
import {
  JANKBOT_JOB_OPTIONS,
  JANKBOT_QUEUE_CONFIG,
  JankbotQueueConfig,
  type JankbotQueueJob,
  OPUS_FRAME_MS,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';
import { TrackedWordsService } from '../tracked-words/tracked-words.service';
import { decodeOpusPackets, loudMs, pcmToWav } from './audio';
import { logJobFailure } from './log-job-failure';
import { vocabularyPrompt } from './vocabulary-prompt';

/**
 * Prepares an utterance's audio and queues its transcription on the transcription worker, as a
 * flow whose parent (TranscribedUtteranceProcessor) matches phrases once the transcript is ready.
 */
// Jobs are quick (decode Opus, add a flow), so a few at once keeps up with bursts of speech.
@Processor(JANKBOT_QUEUE_CONFIG.utterances.queueName, { concurrency: 4 })
export class UtteranceProcessor extends WorkerHost {
  private readonly logger = new Logger(UtteranceProcessor.name);

  constructor(
    private readonly transcriptionClient: TranscriptionClient<JankbotQueueConfig>,
    private readonly trackedWords: TrackedWordsService,
    private readonly environmentService: EnvironmentService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: JankbotQueueJob<'utterances'> | undefined, error: Error) {
    logJobFailure(this.logger, job, error);
  }

  override async process(job: JankbotQueueJob<'utterances'>): Promise<void> {
    const { utteranceId, guildId, channelId, userId, startedAt, opusPackets } =
      job.data;

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
      return;
    }

    // Prompting whisper with the guild's phrases keeps it from mangling made-up words
    // (e.g. "cosclaire" → "cause clair"), which would otherwise never match.
    const phrases = await this.trackedWords.list(guildId);
    await this.transcriptionClient.addFlow({
      // A retry of this job (e.g. after a crash) won't queue a second transcription.
      idempotencyKey: utteranceId,
      request: {
        source: { type: 'inline', data: pcmToWav(pcm).toString('base64') },
        options: { prompt: vocabularyPrompt(phrases) },
      },
      parent: {
        queueKey: 'transcribedUtterances',
        data: {
          utteranceId,
          guildId,
          channelId,
          userId,
          startedAt,
          queuedAt: Date.now(),
          loudMs: loud,
        },
        opts: JANKBOT_JOB_OPTIONS.transcribedUtterances,
      },
      // Still run the parent so failed transcriptions are tracked.
      jobOptions: { onFailure: 'run-parent' },
    });
  }
}
