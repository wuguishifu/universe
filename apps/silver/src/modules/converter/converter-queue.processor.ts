import { Processor, WorkerHost } from '@nestjs/bullmq';
import { OnModuleDestroy } from '@nestjs/common';
import crypto from 'crypto';
import { mkdtempSync, readFile, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SILVER_QUEUE_CONFIG, SilverQueueJob } from '@universe/queue';
import { Box } from '../../types';
import { S3Service } from '../s3/s3.service';
import { YtDlpService } from '../ytdlp/ytdlp.service';

@Processor(SILVER_QUEUE_CONFIG.youtubeConverter.queueName)
export class ConverterQueueProcessor
  extends WorkerHost
  implements OnModuleDestroy
{
  private readonly tempDir: string;

  constructor(
    private readonly s3Service: S3Service,
    private readonly ytDlpService: YtDlpService,
  ) {
    super();
    this.tempDir = mkdtempSync(path.join(tmpdir(), 'silver-temp-'));
  }

  onModuleDestroy() {
    rmSync(this.tempDir, { recursive: true, force: true });
  }

  override async process(job: SilverQueueJob<'youtubeConverter'>) {
    const { url } = job.data;

    const key = crypto.createHash('md5').update(url).digest('hex') + '.mp3';
    const outputPath = path.join(this.tempDir, key);

    const cleanUp = () => {
      rmSync(outputPath);
    };

    const downloadResult = await this.ytDlpService.downloadYoutubeVideo({
      url,
      outputPath,
    });

    if (!downloadResult.success) {
      cleanUp();
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
      return;
    }

    try {
      await this.s3Service.putObject({
        key,
        data: dataResult.data,
        contentType: 'audio/mp3',
      });

      const signedUrl = await this.s3Service.getSignedUrl({ key });
      console.log({ signedUrl });
    } catch (error) {
      cleanUp();

      // throw error again to retry
      throw error;
    }
  }
}
