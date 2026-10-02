import { Module } from '@nestjs/common';
import { LeaderboardCommands } from './leaderboard.commands';
import { LeaderboardService } from './leaderboard.service';

@Module({
  providers: [LeaderboardService, LeaderboardCommands],
  exports: [LeaderboardService, LeaderboardCommands],
})
export class LeaderboardModule {}
