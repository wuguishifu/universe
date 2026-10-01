import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type LeaderboardAccess,
  RUBY_LEADERBOARD_ACCESS_PATH,
  signLeaderboardGrant,
  verifyFeedTicket,
} from '@universe/contracts-ruby';
import { EnvironmentService } from '../../environment/environment-service';
import { ViewerGuildsService } from '../feed/viewer-guilds.service';

/**
 * Lets sapphire's leaderboard page read straight from hydrogen: trades a feed ticket for the
 * viewer's servers and a grant hydrogen accepts for exactly those servers.
 */
@Controller()
export class LeaderboardController {
  constructor(
    private readonly viewerGuilds: ViewerGuildsService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Get(RUBY_LEADERBOARD_ACCESS_PATH)
  async getAccess(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<LeaderboardAccess> {
    const { rubyFeedSecret, rubyConvexSecret } =
      this.environmentService.environment;
    const ticket = authorization?.match(/^Bearer (.+)$/)?.[1];
    const viewer = ticket ? await verifyFeedTicket(ticket, rubyFeedSecret) : null;
    if (!viewer) throw new UnauthorizedException();

    const guilds = await this.viewerGuilds.getGuildsForUser(viewer.sub);
    const { grant, expiresAt } = await signLeaderboardGrant(
      viewer.sub,
      guilds.map((guild) => guild.id),
      rubyConvexSecret,
    );
    return { guilds, grant, expiresAt };
  }
}
