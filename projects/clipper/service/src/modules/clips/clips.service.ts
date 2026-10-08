import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  TranscriptionClient,
  TranscriptionResult,
} from '@platform/transcription-client-nest';
import { ClipJobData } from '@projects/clipper-contracts';
import { ClipperQueueConfig } from '../../queue/queue';
import { AnalysisService } from '../analysis/analysis.service';

const PROCESS_TRANSCRIPTION_OPTS: Job['opts'] = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 60 * 60, count: 1000 },
  removeOnFail: { age: 24 * 60 * 60, count: 1000 },
};

@Injectable()
export class ClipsService {
  constructor(
    private readonly transcriptionClient: TranscriptionClient<ClipperQueueConfig>,
    private readonly analysisService: AnalysisService,
  ) {}

  public async processClips(clips: ClipJobData[]) {
    await this.transcriptionClient.addFlows({
      jobs: clips.map((data) => ({
        data: {
          idempotencyKey: `${data.s3Bucket}/${data.s3Key}`,
          request: {
            source: { type: 's3', bucket: data.s3Bucket, key: data.s3Key },
            options: { beamSize: 5 },
          },
        },
        parent: { data, opts: PROCESS_TRANSCRIPTION_OPTS },
      })),
      queueKey: 'processTranscript',
      jobOptions: { onFailure: 'fail-parent' },
    });
  }

  public async processTranscript({
    jobData,
    result,
  }: {
    jobData: ClipJobData;
    result: TranscriptionResult;
  }) {
    const analysis = await this.analysisService.analyzeTranscript({
      transcript: JSON.stringify(result.transcript.segments, null, 2),
    });
    console.log(
      JSON.stringify(
        {
          analysis,
          analytics: result.analytics,
          jobData,
        },
        null,
        2,
      ),
    );
  }
}
