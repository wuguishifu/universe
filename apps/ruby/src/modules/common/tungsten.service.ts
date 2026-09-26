import { Injectable } from '@nestjs/common';
import { initClient } from '@ts-rest/core';
import { tungstenRootRouter } from '@universe/contracts-tungsten';
import { EnvironmentService } from '../../environment/environment-service';

/** Longer than tungsten's own 60s sync wait, so a 504 from tungsten arrives before we give up. */
const REQUEST_TIMEOUT_MS = 75_000;

/** Typed client for tungsten, the speech-to-text service (apps/tungsten). */
@Injectable()
export class TungstenService {
  private readonly client;

  constructor(environmentService: EnvironmentService) {
    const { tungstenUrl, tungstenApiToken } = environmentService.environment;
    this.client = initClient(tungstenRootRouter, {
      baseUrl: tungstenUrl,
      baseHeaders: { authorization: `Bearer ${tungstenApiToken}` },
    });
  }

  /**
   * Transcribes a short clip on tungsten's interactive lane. `idempotencyKey` makes retries
   * safe: repeating it returns the original result instead of transcribing again.
   */
  transcribe(wav: Buffer, idempotencyKey: string) {
    return this.client.transcription.transcribe({
      body: { source: { type: 'inline', data: wav.toString('base64') } },
      headers: { 'idempotency-key': `ruby:${idempotencyKey}` },
      fetchOptions: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    });
  }
}
