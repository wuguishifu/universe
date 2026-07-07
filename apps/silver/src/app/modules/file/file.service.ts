import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'path';
import { silverRootRouter } from '@universe/contracts-silver';
import { decrypt, encrypt } from '@universe/utils-crypto';
import { EnvironmentService } from '../../../environment/environment-service';

const payloadSchema = z.object({
  fileName: z.string(),
  expiresAt: z.number(),
});

type Payload = z.infer<typeof payloadSchema>;

@Injectable()
export class FileService {
  constructor(private readonly environmentService: EnvironmentService) {}

  private get encryptionKey() {
    return this.environmentService.environment.signingEncryptionKey;
  }

  public getSignedUrl(fileName: string): { url: string; expiresAt: number } {
    const expiresAt = Date.now() + 30 * 60 * 1000;
    const payload: Payload = { fileName, expiresAt };
    const blob = encrypt({ encryptionKey: this.encryptionKey, data: payload });

    const url = new URL(
      silverRootRouter.files.upload.path,
      this.environmentService.environment.silverBaseUrl,
    );
    url.searchParams.set('signature', blob);
    url.searchParams.set('expiresAt', String(expiresAt));

    return {
      url: url.toString(),
      expiresAt,
    };
  }

  public async uploadFile({
    stream,
    signature,
  }: {
    stream: NodeJS.ReadableStream;
    signature: string;
  }) {
    const decrypted = decrypt({
      encryptionKey: this.encryptionKey,
      encryptedPayload: signature,
    });
    const payload = payloadSchema.parse(JSON.parse(decrypted));
    if (payload.expiresAt < Date.now()) throw new Error('URL has expired.');

    const outputPath = path.join(
      this.environmentService.environment.outputPath,
      path.basename(payload.fileName),
    );
    await pipeline(stream, createWriteStream(outputPath));
  }
}
