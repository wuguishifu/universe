import { Module } from '@nestjs/common';
import { registerQueue } from '../../queue/queue';
import { ClipsController } from './clips.controller';
import { ClipsService } from './clips.service';

@Module({
  imports: [registerQueue('processClip')],
  controllers: [ClipsController],
  providers: [ClipsService],
})
export class ClipsModule {}
