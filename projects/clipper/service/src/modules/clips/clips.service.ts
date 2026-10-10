import { Inject, Injectable } from '@nestjs/common';
import { TranscriptionResult } from '@platform/transcription-client-nest';
import { ClipJobData } from '@projects/clipper-contracts';
import {
  CLIPPER_QUEUE_CONFIG,
  CLIPPER_QUEUE_OPTIONS,
  type ClipperQueue,
} from '../../queue/queue';
import { AnalysisService } from '../analysis/analysis.service';

@Injectable()
export class ClipsService {
  constructor(
    @Inject(CLIPPER_QUEUE_CONFIG.preprocessClip.queueName)
    private readonly preprocessClipQueue: ClipperQueue<'preprocessClip'>,
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
    result,
  }: {
    jobData: ClipJobData;
    result: TranscriptionResult;
  }) {
    // TODO:
    // 1. join transcripts into single transcript
    // 2. process with claude api
    // 3. ...
    // const analysis = await this.analysisService.analyzeTranscript({
    //   transcript: JSON.stringify(result.transcript.segments, null, 2),
    // });
  }
}
