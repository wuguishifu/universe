import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { TrackingService } from '@platform/analytics-client-nest';
import {
  isFulfilled,
  TranscriptionOutcome,
  TranscriptionResult,
} from '@platform/transcription-client-nest';
import { ClipJobData } from '@projects/clipper-contracts';
import {
  CLIPPER_QUEUE_CONFIG,
  CLIPPER_QUEUE_OPTIONS,
  ProcessTranscriptsJobData,
  type ClipperQueue,
} from '../../queue/queue';
import { AnalysisService } from '../analysis/analysis.service';

@Injectable()
export class ClipsService {
  constructor(
    @Inject(CLIPPER_QUEUE_CONFIG.preprocessClip.queueName)
    private readonly preprocessClipQueue: ClipperQueue<'preprocessClip'>,
    private readonly trackingService: TrackingService,
    private readonly analysisService: AnalysisService,
  ) {}

  public async processClips(clips: ClipJobData[]) {
    await this.preprocessClipQueue.addBulk(
      clips.map((clip) => ({
        name: CLIPPER_QUEUE_CONFIG.preprocessClip.jobName,
        data: clip,
        opts: CLIPPER_QUEUE_OPTIONS.preprocessClip,
      })),
    );
  }

  public async processTranscripts({
    jobData,
    results,
  }: {
    jobData: ProcessTranscriptsJobData;
    results: Record<string, TranscriptionOutcome>;
  }) {
    if (results.primary?.status !== 'fulfilled') {
      this.trackingService.trackEvent({
        name: 'process_transcripts-failed',
        extra: { reason: 'primaryTranscriptNotFulfilled' },
      });
      throw new UnrecoverableError('Primary transcript not fulfilled');
    }

    const segments = Object.entries(results)
      .filter(
        (
          item,
        ): item is [
          string,
          { status: 'fulfilled'; value: TranscriptionResult },
        ] => isFulfilled(item[1]),
      )
      .flatMap(([type, result]) =>
        result.value.transcript.segments.map((item) => ({
          ...item,
          speaker: getSpeakerFromType(type),
        })),
      )
      .sort((a, b) => {
        if (a.startMs === b.startMs) return a.endMs - b.endMs;
        return a.startMs - b.startMs;
      });

    console.log(JSON.stringify({ segments }, null, 2));

    // TODO:
    // 1. diarize
    // ...

    // 2. process with claude api
    // const analysis = await this.analysisService.analyzeTranscript({
    //   transcript: JSON.stringify(segments, null, 2),
    // });

    // 3. ...
  }
}

function getSpeakerFromType(type: string) {
  switch (type) {
    case 'primary':
      return 'host';
    case 'secondary':
      return 'others';
    case 'extra':
      return 'game';
    default:
      return 'unknown';
  }
}
