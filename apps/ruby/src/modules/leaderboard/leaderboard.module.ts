import { Module } from '@nestjs/common';
import { FeedModule } from '../feed/feed.module';
import { LeaderboardCommands } from './leaderboard.commands';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

@Module({
  imports: [FeedModule],
  controllers: [LeaderboardController],
  providers: [LeaderboardService, LeaderboardCommands],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}
