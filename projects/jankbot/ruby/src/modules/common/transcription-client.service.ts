import { Injectable } from '@nestjs/common';
import { initClient } from '@ts-rest/core';
import { transcriptionRootRouter } from '@universe/platform/transcription/contracts';
import { EnvironmentService } from '../../environment/environment-service';

/** Longer than transcription-service's own 60s sync wait, so a 504 from transcription-service arrives before we give up. */
const REQUEST_TIMEOUT_MS = 75_000;

/** Typed client for transcription-service, the speech-to-text service (platform/transcription/service). */
@Injectable()
export class TranscriptionClientService {
  private readonly client;

  constructor(environmentService: EnvironmentService) {
    const { transcriptionServiceUrl, transcriptionServiceApiToken } =
      environmentService.environment;
    this.client = initClient(transcriptionRootRouter, {
      baseUrl: transcriptionServiceUrl,
      baseHeaders: { authorization: `Bearer ${transcriptionServiceApiToken}` },
    });
  }

  /**
   * Transcribes a short clip on transcription-service's interactive lane. `idempotencyKey` makes retries
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
