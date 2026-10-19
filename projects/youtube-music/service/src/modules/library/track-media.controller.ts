import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  S3ObjectNotFoundError,
  S3RangeNotSatisfiableError,
} from '@libs/nest-common';
import { AllowQueryToken } from '../../auth/api-token.guard';
import { StorageService } from './storage.service';
import { TracksService } from './tracks.service';

/** A track's files never change once it's ready, and its key is unique to the video. */
const CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * Streams tracks' files from S3 through the service, so the app only ever needs to reach the
 * service. Range requests are passed on to S3, which is how players seek.
 */
@Controller('api/tracks')
@AllowQueryToken()
export class TrackMediaController {
  constructor(
    private readonly tracksService: TracksService,
    private readonly storageService: StorageService,
  ) {}

  @Get(':id/audio')
  async audio(
    @Param('id', ParseIntPipe) id: number,
    @Headers('range') range: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const track = await this.tracksService.find(id);
    if (!track?.audioKey)
      throw new NotFoundException(`No audio for track ${id}`);
    await this.send(reply, track.audioKey, track.audioMimeType, range);
  }

  @Get(':id/artwork')
  async artwork(
    @Param('id', ParseIntPipe) id: number,
    @Res() reply: FastifyReply,
  ) {
    const track = await this.tracksService.find(id);
    if (!track?.artworkKey) {
      throw new NotFoundException(`No artwork for track ${id}`);
    }
    await this.send(reply, track.artworkKey, 'image/jpeg');
  }

  private async send(
    reply: FastifyReply,
    key: string,
    contentType: string | null,
    range?: string,
  ) {
    let object;
    try {
      object = await this.storageService.stream(key, range);
    } catch (error) {
      if (error instanceof S3RangeNotSatisfiableError) {
        return reply.status(416).send();
      }
      if (error instanceof S3ObjectNotFoundError) {
        throw new NotFoundException();
      }
      throw error;
    }

    reply
      .status(object.contentRange ? 206 : 200)
      .header('Content-Type', contentType ?? object.contentType)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', CACHE_CONTROL);
    if (object.contentLength !== undefined) {
      reply.header('Content-Length', object.contentLength);
    }
    if (object.contentRange) reply.header('Content-Range', object.contentRange);
    return reply.send(object.body);
  }
}
