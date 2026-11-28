import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type Queue } from 'bullmq';

import { randomUUID } from 'crypto';

import { TokenAuthGuard } from '../../auth/token-auth.guard';
import { JANKTM_QUEUE_CONFIG, type JanktmJobData } from '../../queues/queue';
import { jobStatus } from '../common/job-status';
import { isAlbumName } from '../media/album-objects';

type ScanQueue = Queue<JanktmJobData<'scan'>>;

/** One scan at a time. */
const SCAN_DEDUPLICATION_ID = 'album-scan';

@UseGuards(TokenAuthGuard)
@Controller('api/scans')
export class ScansController {
  constructor(
    @Inject(JANKTM_QUEUE_CONFIG.scan.queueName)
    private readonly queue: ScanQueue,
  ) {}

  /**
   * Starts a scan of the whole bucket, or of one album's folder with `?album=<folder name>`.
   * One at a time: 409 while another is queued or running.
   */
  @Post()
  @HttpCode(202)
  public async start(@Query('album') album?: string) {
    if (album !== undefined && !isAlbumName(album)) {
      throw new BadRequestException(
        'album is one top-level folder\'s name, e.g. "2022-06-12 GRADUATION!"',
      );
    }
    const scannedAt = Date.now();
    // Unique per request, so a request that's deduplicated always gets someone else's ID back.
    const scanId = `scan-${scannedAt}-${randomUUID().slice(0, 8)}`;
    // Deduplicated in Redis, atomically: until the scan in progress completes or finally fails,
    // adding another returns it instead, whichever instance asks.
    const job = await this.queue.add(
      JANKTM_QUEUE_CONFIG.scan.jobName,
      { album, scannedAt },
      { jobId: scanId, deduplication: { id: SCAN_DEDUPLICATION_ID } },
    );
    if (job.id !== scanId) {
      throw new ConflictException({
        message: 'A scan is already running',
        scanId: job.id,
      });
    }
    return { scanId };
  }

  @Get(':id')
  public async status(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`No scan ${id}`);
    return await jobStatus(job);
  }
}
