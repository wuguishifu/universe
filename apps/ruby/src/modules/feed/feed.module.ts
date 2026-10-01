import { Module } from '@nestjs/common';
import { FeedGateway } from './feed.gateway';
import { FeedService } from './feed.service';
import { SpeakerProfilesService } from './speaker-profiles.service';
import { ViewerGuildsService } from './viewer-guilds.service';

@Module({
  providers: [
    FeedService,
    FeedGateway,
    SpeakerProfilesService,
    ViewerGuildsService,
  ],
  exports: [FeedService, SpeakerProfilesService, ViewerGuildsService],
})
export class FeedModule {}
