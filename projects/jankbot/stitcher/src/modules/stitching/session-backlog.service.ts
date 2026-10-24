import { Inject, Injectable } from '@nestjs/common';

import {
  JANKBOT_QUEUE_CONFIG,
  type JankbotQueue,
} from '@projects/jankbot-contracts';

/**
 * Finds a session's utterances that could still become recordings: queued in core, or waiting on
 * their transcription. The transcription worker can fall well behind real time, so "a few minutes
 * after the session ended" isn't enough to know they're all in.
 */
@Injectable()
export class SessionBacklogService {
  constructor(
    @Inject(JANKBOT_QUEUE_CONFIG.utterances.queueName)
    private readonly utterances: JankbotQueue<'utterances'>,
    @Inject(JANKBOT_QUEUE_CONFIG.transcribedUtterances.queueName)
    private readonly transcribedUtterances: JankbotQueue<'transcribedUtterances'>,
  ) {}

  async pendingUtterances(sessionId: string): Promise<number> {
    // Retries wait in 'delayed'. A transcribed-utterances job sits in 'waiting-children' until its
    // transcription is done, so these cover every step between the gateway and a recording.
    const [utterances, transcribed] = await Promise.all([
      this.utterances.getJobs(['waiting', 'prioritized', 'active', 'delayed']),
      this.transcribedUtterances.getJobs([
        'waiting-children',
        'waiting',
        'prioritized',
        'active',
        'delayed',
      ]),
    ]);
    // A job can be removed between being listed and fetched, which leaves a hole.
    return [...utterances, ...transcribed].filter(
      (job) => job?.data.sessionId === sessionId,
    ).length;
  }
}
