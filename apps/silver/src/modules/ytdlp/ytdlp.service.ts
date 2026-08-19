import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { once } from 'events';
import { Box } from '../../types';

@Injectable()
export class YtDlpService {
  private readonly logger = new Logger(YtDlpService.name);

  public async downloadYoutubeVideo({
    url,
    outputPath,
  }: {
    url: string;
    outputPath: string;
  }): Promise<Box> {
    const abortController = new AbortController();
    const process = spawn('yt-dlp', [
      '--extract-audio',
      '--extractor-args',
      'youtube:player_client=android',
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
      return {
        success: false,
        reason: `yt-dlp exited with non-zero exit code (${process.exitCode})`,
      };
    }

    return { success: true };
  }
}
