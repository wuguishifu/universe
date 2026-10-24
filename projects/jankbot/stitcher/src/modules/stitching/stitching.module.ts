import { Module } from '@nestjs/common';

import { registerQueue } from '../../queues/queue';

import { CompilationEncoderService } from './compilation-encoder.service';
import { SessionBacklogService } from './session-backlog.service';
import { StitchSessionProcessor } from './stitch-session.processor';

@Module({
  imports: [
    registerQueue('stitchSessions'),
    // Only read, to tell whether a session still has utterances on the way.
    registerQueue('utterances'),
    registerQueue('transcribedUtterances'),
  ],
  providers: [
    SessionBacklogService,
    CompilationEncoderService,
    StitchSessionProcessor,
  ],
})
export class StitchingModule {}
