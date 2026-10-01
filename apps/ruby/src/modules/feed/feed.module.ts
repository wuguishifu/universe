import { Module } from '@nestjs/common';
import { FeedGateway } from './feed.gateway';
import { FeedService } from './feed.service';
import { SpeakerProfilesService } from './speaker-profiles.service';

@Module({
  providers: [FeedService, FeedGateway, SpeakerProfilesService],
  exports: [FeedService],
})
export class FeedModule {}
