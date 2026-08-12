import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { once } from 'events';
import { mkdtempSync, readFile, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { S3Service } from '../s3/s3.service';

@Injectable()
export class ConverterService implements OnModuleDestroy {
  private readonly logger = new Logger(ConverterService.name);
  private readonly tempDir: string;

  constructor(private readonly s3Service: S3Service) {
    this.tempDir = mkdtempSync(path.join(tmpdir(), 'silver-temp-'));
  }

  onModuleDestroy() {
    rmSync(this.tempDir, { recursive: true, force: true });
  }

  public async convert(url: string) {
    const abortController = new AbortController();

    const key = crypto.createHash('md5').update(url).digest('hex') + '.mp3';
    const outputPath = path.join(this.tempDir, key);
    const process = spawn('yt-dlp', [
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '0',
      '-o',
      outputPath,
      url,
    ]);

    const timeout = setTimeout(() => abortController.abort(), 60 * 1000);

    process.stderr.on('data', (data) => this.logger.debug(data.toString()));
    process.stdout.on('data', (data) => this.logger.debug(data.toString()));

    await once(process, 'close');
    clearTimeout(timeout);

    if (process.exitCode !== 0) {
      throw new Error('convert failed');
    }

    const data = await new Promise<NonSharedBuffer>((resolve, reject) => {
      readFile(outputPath, (error, data) => {
        if (error) return reject(error);
        return resolve(data);
      });
    });

    await this.s3Service.putObject({
      key,
      data,
      contentType: 'audio/mp3',
    });

    return await this.s3Service.getSignedUrl({ key });
  }
}
