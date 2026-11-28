import {
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

import { TokenAuthGuard } from '../../auth/token-auth.guard';
import { JANKTM_QUEUE_CONFIG, type JanktmJobData } from '../../queues/queue';
import { jobStatus } from '../common/job-status';

type ScanQueue = Queue<JanktmJobData<'scan'>>;

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
    const running = await this.queue.getJobCountByTypes(
      'active',
      'waiting',
      'delayed',
      'prioritized',
    );
    if (running > 0) throw new ConflictException('A scan is already running');
    const scannedAt = Date.now();
    const job = await this.queue.add(
      JANKTM_QUEUE_CONFIG.scan.jobName,
      { album: album || undefined, scannedAt },
      { jobId: `scan-${scannedAt}` },
    );
    return { scanId: job.id };
  }

  @Get(':id')
  public async status(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) throw new NotFoundException(`No scan ${id}`);
    return await jobStatus(job);
  }
}
