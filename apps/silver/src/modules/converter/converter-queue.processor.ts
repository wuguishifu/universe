import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { mkdtempSync, readFile, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { api } from '@universe/hydrogen-kore';
import { SILVER_QUEUE_CONFIG, SilverQueueJob } from '@universe/queue';
import { Box } from '../../types';
import { ConvexClientService } from '../common/convex-client.service';
import { S3Service } from '../s3/s3.service';
import { YtDlpService } from '../ytdlp/ytdlp.service';
import { s3Key, watchUrl } from './youtube-id';

@Processor(SILVER_QUEUE_CONFIG.youtubeConverter.queueName)
export class ConverterQueueProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly tempDir: string;
  private readonly logger = new Logger(ConverterQueueProcessor.name);

  constructor(
    private readonly s3Service: S3Service,
    private readonly ytDlpService: YtDlpService,
    private readonly convexClientService: ConvexClientService,
  ) {
    super();
    this.tempDir = mkdtempSync(path.join(tmpdir(), 'silver-temp-'));
  }

  onModuleDestroy() {
    rmSync(this.tempDir, { recursive: true, force: true });
  }

  private async updateStatus(
    youtubeId: string,
    status: typeof api.silver.converter.audioConversions.updateStatus._args.status,
    statusDescription?: string,
  ) {
    await this.convexClientService.client.mutation(
      api.silver.converter.audioConversions.updateStatus,
      { youtubeId, status, statusDescription },
    );
  }

  override async process(job: SilverQueueJob<'youtubeConverter'>) {
    const { videoId: youtubeId } = job.data;

    const key = s3Key(youtubeId);
    if (await this.s3Service.exists(key)) {
      await this.updateStatus(youtubeId, 'completed');
      return;
    }

    const outputPath = path.join(this.tempDir, key);

    const cleanUp = () => {
      rmSync(outputPath, { force: true });
    };

    await this.updateStatus(youtubeId, 'processing', 'downloading');
    const downloadResult = await this.ytDlpService.downloadYoutubeVideo({
      url: watchUrl(youtubeId),
      outputPath,
    });

    if (!downloadResult.success) {
      cleanUp();
      await this.updateStatus(youtubeId, 'failed', 'failed to download');
      return;
    }

    const dataResult = await new Promise<Box<NonSharedBuffer>>((resolve) => {
      readFile(outputPath, (error, data) => {
        if (error) return resolve({ success: false, reason: error.message });
        return resolve({ success: true, data });
      });
    });

    if (!dataResult.success) {
      cleanUp();
      await this.updateStatus(youtubeId, 'failed', 'could not read buffer');
      return;
    }

    try {
      await this.updateStatus(youtubeId, 'processing', 'uploading');
      await this.s3Service.putObject({
        key,
        data: dataResult.data,
        contentType: 'audio/mp3',
      });

      const signedUrl = await this.s3Service.getSignedUrl(key);
      this.logger.log(signedUrl);
      await this.updateStatus(youtubeId, 'completed');
    } catch (error) {
      cleanUp();
      await this.updateStatus(youtubeId, 'failed', 'failed to upload');

      // throw error again to retry
      throw error;
    }
  }
}
