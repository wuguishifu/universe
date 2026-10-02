import { Module } from '@nestjs/common';
import { registerQueue } from '../../queues/queue';
import { InteractionRouter } from './interaction-router';

@Module({
  imports: [registerQueue('interactions')],
  providers: [InteractionRouter],
})
export class InteractionsModule {}
