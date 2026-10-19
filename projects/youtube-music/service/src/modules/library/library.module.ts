import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { DownloadProcessor } from './download.processor';
import { DownloadsService } from './downloads.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';
import { StorageService } from './storage.service';
import { TrackMediaController } from './track-media.controller';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';

@Module({
  imports: [MediaModule],
  controllers: [
    TracksController,
    TrackMediaController,
    PlaylistsController,
    ImportsController,
  ],
  providers: [
    TracksService,
    PlaylistsService,
    StorageService,
    DownloadsService,
    ImportsService,
    DownloadProcessor,
  ],
})
export class LibraryModule {}
