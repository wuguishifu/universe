import { Injectable } from '@nestjs/common';

@Injectable()
export class ClipperService {
  public async queueJob({ filePath }: { filePath: string }) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
