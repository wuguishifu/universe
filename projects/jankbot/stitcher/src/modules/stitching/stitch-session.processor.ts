import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { DelayedError, UnrecoverableError } from 'bullmq';
import { asc, eq } from 'drizzle-orm';
import { createReadStream } from 'fs';
import { mkdtemp, open, rm } from 'fs/promises';
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
  phraseSlug,
} from '@projects/jankbot-contracts';
import { EnvironmentService } from '../../environment/environment';
import {
  type ClipRange,
  normalizeLoudness,
  prepareClips,
  silence,
  slicePcm,
  utteranceByteRange,
} from './audio';
import { CompilationEncoderService } from './compilation-encoder.service';
import { SessionBacklogService } from './session-backlog.service';

const { recordings } = jankbotSchema;
type Recording = typeof recordings.$inferSelect;

/** How often to check again while a session's utterances are still being transcribed. */
const BACKLOG_RECHECK_MS = 60_000;
/**
 * How far past whisper's word timings to look for where the speech starts and stops. Further back
 * than forward, since its timings run late. Tuned on real voice chat: further than this and clips
 * start taking in neighboring words, since people rarely pause between them.
 */
const CLIP_SNAP = { searchBeforeMs: 300, searchAfterMs: 150 };
/** Softens cuts that have to land mid-sound, where there was no pause to cut at. */
const CLIP_FADE_MS = 25;
const CLIP_GAP_MS = 300;
/**
 * How much of the utterance to read around a recording's clips: enough for CLIP_SNAP's search and
 * for moving a late timing back, plus context to judge how loud the speaker is. A multiple of 20ms.
 */
const READ_BEFORE_MS = 1000;
const READ_AFTER_MS = 500;
/** Recordings read ahead of the one being written, to hide S3 latency. */
const READ_AHEAD = 4;

/**
 * Compiles a finished session's recordings into one Ogg Opus file per phrase, in S3. Sessions can
 * last many hours, so it never holds more than READ_AHEAD recordings' audio: each is read from S3
 * as just the bytes around its clips, and the compilation is built up on disk.
 */
// One at a time: a long session means thousands of reads, and nothing is waiting on the result.
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
      for (const [phrase, phraseRows] of groupByPhrase(rows)) {
        const pcmPath = path.join(workDir, `${phraseSlug(phrase)}.pcm`);
        const clipCount = await this.writeCompilation(phraseRows, pcmPath);
        if (clipCount === 0) {
          this.logger.warn(
            `[${guildId}] Session ${sessionId}: no audio left for "${phrase}"`,
          );
          continue;
        }

        const oggPath = await this.encoder.encodeOggOpus(pcmPath);
        const key = createCompilationS3Key(sessionId, phrase);
        await this.s3.putObject({
          bucket: recordingsS3Bucket,
          key,
          data: createReadStream(oggPath),
          contentType: 'audio/ogg',
        });
        this.logger.log(
          `[${guildId}] Session ${sessionId}: "${phrase}" x${clipCount} → s3://${recordingsS3Bucket}/${key}`,
        );
        await rm(pcmPath, { force: true });
        await rm(oggPath, { force: true });
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Writes the rows' clips to `pcmPath`, in order and with gaps between them, and returns how many
   * there were.
   */
  private async writeCompilation(
    rows: Recording[],
    pcmPath: string,
  ): Promise<number> {
    const file = await open(pcmPath, 'w');
    const gap = silence(CLIP_GAP_MS);
    let count = 0;
    try {
      for await (const clips of mapInOrder(rows, READ_AHEAD, (row) =>
        this.readClips(row),
      )) {
        for (const clip of clips) {
          if (count > 0) await file.write(gap);
          await file.write(clip);
          count++;
        }
      }
    } finally {
      await file.close();
    }
    return count;
  }

  /**
   * A recording's clips, cut and leveled, from a ranged read of its utterance. None when the
   * utterance's upload failed in core, or the bucket's lifecycle rule already expired it.
   */
  private async readClips(row: Recording): Promise<Buffer[]> {
    const clips: ClipRange[] = row.clips.map(({ clipStartMs, clipEndMs }) => ({
      startMs: clipStartMs,
      endMs: clipEndMs,
    }));
    const offsetMs = Math.max(
      0,
      Math.floor(
        (Math.min(...clips.map(({ startMs }) => startMs)) - READ_BEFORE_MS) /
          20,
      ) * 20,
    );
    const endMs = Math.max(...clips.map(({ endMs }) => endMs)) + READ_AFTER_MS;

    let pcm: Buffer;
    try {
      pcm = await this.s3.getObjectRange({
        bucket: this.environmentService.environment.recordingsS3Bucket,
        key: createUtteranceS3Key(row.utteranceId),
        ...utteranceByteRange(offsetMs, endMs),
      });
    } catch (error) {
      if (!(error instanceof S3ObjectNotFoundError)) throw error;
      this.logger.warn(`Utterance ${row.utteranceId} isn't in S3; skipping it`);
      return [];
    }

    // Times relative to the start of what was read.
    const relative = clips.map(({ startMs, endMs }) => ({
      startMs: startMs - offsetMs,
      endMs: endMs - offsetMs,
    }));
    return prepareClips(relative, pcm, CLIP_SNAP).map((range) =>
      normalizeLoudness(slicePcm(pcm, range, CLIP_FADE_MS)),
    );
  }
}

/**
 * Maps the items in order, running up to `concurrency` calls at once: the results come out in the
 * items' order while later calls are already under way.
 */
async function* mapInOrder<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): AsyncGenerator<R> {
  // Settled up front, so a call that fails while an earlier one is awaited isn't an unhandled
  // rejection; its error is thrown when its turn comes.
  const start = (item: T) =>
    fn(item).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  const pending = items.slice(0, concurrency).map(start);
  for (let next = pending.length; pending.length > 0; next++) {
    const result = await pending.shift();
    const item = items[next];
    if (item !== undefined) pending.push(start(item));
    if (!result) continue;
    if (!result.ok) throw result.error;
    yield result.value;
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
