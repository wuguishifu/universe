import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { asc, eq } from 'drizzle-orm';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
  S3ObjectNotFoundError,
  S3Service,
  UNIVERSE_DB,
  type UniverseDb,
} from '@libs/nest-common';
import { jankbotSchema } from '@platform/postgres-db';
import {
  createCompilationS3Key,
  createUtteranceS3Key,
  JANKBOT_QUEUE_CONFIG,
  type JankbotQueueJob,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';
import {
  joinWithGaps,
  pcmDurationMs,
  prepareClips,
  readWavPcm,
  slicePcm,
} from './audio';
import { CompilationEncoderService } from './compilation-encoder.service';
import { SessionBacklogService } from './session-backlog.service';

const { recordings } = jankbotSchema;
type Recording = typeof recordings.$inferSelect;

/** How often to check again while a session's utterances are still being transcribed. */
const BACKLOG_RECHECK_MS = 60_000;
/** Whisper's segment timings are rough; this keeps the phrase's first and last words whole. */
const CLIP_PADDING = { padBeforeMs: 150, padAfterMs: 250 };
const CLIP_FADE_MS = 10;
const CLIP_GAP_MS = 300;
const DOWNLOAD_CONCURRENCY = 4;

/** Compiles a finished session's recordings into one Ogg Opus file per phrase, in S3. */
// One at a time: a session can mean hundreds of downloads, and nothing is waiting on the result.
@Processor(JANKBOT_QUEUE_CONFIG.stitchSessions.queueName, { concurrency: 1 })
export class StitchSessionProcessor extends WorkerHost {
  private readonly logger = new Logger(StitchSessionProcessor.name);

  constructor(
    @Inject(UNIVERSE_DB) private readonly universeDb: UniverseDb,
    private readonly s3: S3Service,
    private readonly backlog: SessionBacklogService,
    private readonly encoder: CompilationEncoderService,
    private readonly environmentService: EnvironmentService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: JankbotQueueJob<'stitchSessions'> | undefined, error: Error) {
    if (!job) {
      this.logger.error(`Job failed: ${error.message}`);
      return;
    }
    const { guildId, sessionId } = job.data;
    const attempts = job.opts.attempts ?? 1;
    const final =
      error instanceof UnrecoverableError || job.attemptsMade >= attempts;
    this.logger[final ? 'error' : 'warn'](
      `[${guildId}] Session ${sessionId}: attempt ${job.attemptsMade}/${attempts} failed: ${error.message}${final ? ' (giving up)' : ' (will retry)'}`,
    );
  }

  override async process(
    job: JankbotQueueJob<'stitchSessions'>,
    token?: string,
  ): Promise<void> {
    const { sessionId, guildId, endedAt } = job.data;
    const { stitchMaxWaitMs, recordingsS3Bucket } =
      this.environmentService.environment;

    if (Date.now() - endedAt < stitchMaxWaitMs) {
      const pending = await this.backlog.pendingUtterances(sessionId);
      if (pending > 0) {
        this.logger.log(
          `[${guildId}] Session ${sessionId}: ${pending} utterances still on the way; checking again in ${BACKLOG_RECHECK_MS / 1000}s`,
        );
        // Doesn't use up an attempt.
        await job.moveToDelayed(Date.now() + BACKLOG_RECHECK_MS, token);
        throw new DelayedError();
      }
    }

    const rows = await this.universeDb
      .select()
      .from(recordings)
      .where(eq(recordings.sessionId, sessionId))
      .orderBy(asc(recordings.phrase), asc(recordings.timestamp));
    if (rows.length === 0) {
      this.logger.log(`[${guildId}] Session ${sessionId}: nothing to stitch`);
      return;
    }

    const workDir = await mkdtemp(path.join(tmpdir(), 'jankbot-stitcher-'));
    try {
      const audio = await this.downloadUtterances(
        rows.map(({ utteranceId }) => utteranceId),
        workDir,
      );

      for (const [phrase, phraseRows] of groupByPhrase(rows)) {
        const clips = phraseRows.flatMap((row) => {
          const pcm = audio.get(row.utteranceId);
          if (!pcm) return [];
          const ranges = prepareClips(
            row.clips.map(({ clipStartMs, clipEndMs }) => ({
              startMs: clipStartMs,
              endMs: clipEndMs,
            })),
            pcmDurationMs(pcm),
            CLIP_PADDING,
          );
          return ranges.map((range) => slicePcm(pcm, range, CLIP_FADE_MS));
        });
        if (clips.length === 0) {
          this.logger.warn(
            `[${guildId}] Session ${sessionId}: no audio left for "${phrase}"`,
          );
          continue;
        }

        const ogg = await this.encoder.encodeOggOpus(
          joinWithGaps(clips, CLIP_GAP_MS),
          workDir,
        );
        const key = createCompilationS3Key(sessionId, phrase);
        await this.s3.putObject({
          bucket: recordingsS3Bucket,
          key,
          data: ogg,
          contentType: 'audio/ogg',
        });
        this.logger.log(
          `[${guildId}] Session ${sessionId}: "${phrase}" x${clips.length} → s3://${recordingsS3Bucket}/${key}`,
        );
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Each utterance's PCM, downloaded once even when it has several phrases. Utterances whose
   * upload failed in core (or that the bucket's lifecycle rule already expired) are left out.
   */
  private async downloadUtterances(
    utteranceIds: string[],
    workDir: string,
  ): Promise<Map<string, Buffer>> {
    const { recordingsS3Bucket } = this.environmentService.environment;
    const unique = [...new Set(utteranceIds)];
    const audio = new Map<string, Buffer>();

    for (let i = 0; i < unique.length; i += DOWNLOAD_CONCURRENCY) {
      await Promise.all(
        unique.slice(i, i + DOWNLOAD_CONCURRENCY).map(async (utteranceId) => {
          const filePath = path.join(workDir, `${utteranceId}.wav`);
          try {
            await this.s3.downloadToFile(
              recordingsS3Bucket,
              createUtteranceS3Key(utteranceId),
              filePath,
            );
          } catch (error) {
            if (!(error instanceof S3ObjectNotFoundError)) throw error;
            this.logger.warn(
              `Utterance ${utteranceId} isn't in S3; skipping it`,
            );
            return;
          }
          try {
            audio.set(utteranceId, readWavPcm(await readFile(filePath)));
          } catch (error) {
            // A retry would read the same file, so one bad upload shouldn't fail the session.
            this.logger.warn(
              `Utterance ${utteranceId} isn't usable audio; skipping it: ${error instanceof Error ? error.message : error}`,
            );
          } finally {
            await rm(filePath, { force: true });
          }
        }),
      );
    }
    return audio;
  }
}

/** Keeps each phrase's rows in the order they were queried (by timestamp). */
function groupByPhrase(rows: Recording[]): Map<string, Recording[]> {
  const groups = new Map<string, Recording[]>();
  for (const row of rows) {
    const group = groups.get(row.phrase);
    if (group) group.push(row);
    else groups.set(row.phrase, [row]);
  }
  return groups;
}
