import { WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { S3Service } from '@libs/nest-common';
import { UniverseProcessor } from '@libs/queue';
import { TrackingService } from '@platform/analytics-client-nest';
import {
  TranscriptionClient,
  TranscriptionRequest,
} from '@platform/transcription-client-nest';
import {
  CLIPPER_QUEUE_CONFIG,
  CLIPPER_QUEUE_OPTIONS,
  ClipperQueueConfig,
  ClipperQueueJob,
} from '../../../queue/queue';
import { getFileId } from '../../../utils/getFileId';
import { FFmpegService } from '../../ffmpeg/ffmpeg.service';
import { FFprobeService } from '../../ffmpeg/ffprobe.service';
import { FFprobeStream } from '../../ffmpeg/stream-types';

@UniverseProcessor(CLIPPER_QUEUE_CONFIG, 'preprocessClip', { concurrency: 4 })
export class PreprocessClipProcessor extends WorkerHost {
  constructor(
    private readonly s3: S3Service,
    private readonly ffprobeService: FFprobeService,
    private readonly ffmpegService: FFmpegService,
    private readonly trackingService: TrackingService,
    private readonly transcriptionClient: TranscriptionClient<ClipperQueueConfig>,
  ) {
    super();
  }

  override async process(job: ClipperQueueJob<'preprocessClip'>) {
    const { s3Bucket, s3Key, ...clipMetadata } = job.data;

    const signedUrl = await this.s3.getSignedUrl({
      bucket: s3Bucket,
      key: s3Key,
      expiresInS: 60 * 60,
    });

    const identifiedStreams = await this.ffprobeService.identifyStreams({
      inputPath: signedUrl,
    });

    const filteredStreams = identifiedStreams.reduce<{
      primaryStream?: FFprobeStream;
      secondaryStream?: FFprobeStream;
      extraStream?: FFprobeStream;
    }>((acc, curr) => {
      switch (curr.type) {
        case 'primary':
          acc.primaryStream = curr;
          break;
        case 'secondary':
          acc.secondaryStream = curr;
          break;
        case 'extra':
          acc.extraStream = curr;
          break;
      }
      return acc;
    }, {});

    // if there's at least a primary stream we can make an attempt
    const primaryStream = filteredStreams.primaryStream;
    if (!primaryStream) {
      this.trackingService.trackEvent({
        name: 'preprocess_clip-failed',
        extra: { reason: 'noPrimaryUserStream' },
      });
      throw new UnrecoverableError('No primary user stream found');
    }

    // legacy versions of medal didn't have a separate discord and game stream
    // so sometimes the voice chat and game are mixed onto the game stream
    const secondaryStream =
      filteredStreams.secondaryStream ?? filteredStreams.extraStream;

    const extraStream =
      secondaryStream === filteredStreams.extraStream
        ? undefined
        : filteredStreams.extraStream;

    const streams = [
      primaryStream,
      ...(secondaryStream ? [secondaryStream] : []),
      ...(extraStream ? [extraStream] : []),
    ];

    const fileIdHash = getFileId(clipMetadata);
    const outputDir = await mkdtemp(path.join(tmpdir(), 'clipper-worker-'));

    try {
      const results = await this.ffmpegService.extractStreams({
        inputPath: signedUrl,
        outputDir,
        streams,
      });

      await Promise.all(
        results.map((result) =>
          this.s3.putObject({
            bucket: s3Bucket,
            key: `tmp/${fileIdHash}/${result.fileName}`,
            contentType: 'audio/wav',
            data: createReadStream(result.filePath),
          }),
        ),
      );

      await this.transcriptionClient.addFlow({
        idempotencyKey: fileIdHash,
        parent: {
          queueKey: 'processTranscripts',
          data: {
            ...clipMetadata,
          },
          opts: CLIPPER_QUEUE_OPTIONS.processTranscripts,
        },
        jobOptions: { onFailure: 'run-parent' },
        requests: Object.fromEntries<TranscriptionRequest>(
          results.map((result) => [
            result.fileName,
            {
              source: {
                type: 's3',
                bucket: s3Bucket,
                key: `tmp/${fileIdHash}/${result.fileName}`,
              },
              options: {
                beamSize: 5,
                prompt: '[laughter], [laughing], lol, haha',
              },
            },
          ]),
        ),
      });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }
}
