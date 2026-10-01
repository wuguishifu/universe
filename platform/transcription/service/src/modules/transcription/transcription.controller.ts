import { Controller } from '@nestjs/common';
import type { AppRoute } from '@ts-rest/core';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { tungstenRootRouter } from '@universe/platform/transcription/contracts';
import {
  InvalidTranscriptionRequestError,
  TranscriptionApiService,
  TranscriptionFailedError,
  TranscriptionTimeoutError,
} from './transcription-api.service';

const router = tungstenRootRouter.transcription;

/**
 * Explicit return type for handlers: with request headers in the contract, the inferred type
 * references a ts-rest internal that declaration emit can't name.
 */
type Handler<T extends AppRoute> = ReturnType<typeof tsRestHandler<T>>;

@Controller()
export class TranscriptionController {
  constructor(private readonly transcriptionApi: TranscriptionApiService) {}

  @TsRestHandler(router.transcribe)
  public handleTranscribe(): Handler<typeof router.transcribe> {
    return tsRestHandler(router.transcribe, async ({ body, headers }) => {
      try {
        const transcript = await this.transcriptionApi.transcribe(
          body,
          headers['idempotency-key'],
        );
        return { status: 200, body: transcript };
      } catch (error) {
        if (error instanceof InvalidTranscriptionRequestError) {
          return { status: 400, body: { message: error.message } };
        }
        if (error instanceof TranscriptionFailedError) {
          return { status: 422, body: { message: error.message } };
        }
        if (error instanceof TranscriptionTimeoutError) {
          return { status: 504, body: { message: error.message } };
        }
        throw error;
      }
    });
  }

  @TsRestHandler(router.createJob)
  public handleCreateJob(): Handler<typeof router.createJob> {
    return tsRestHandler(router.createJob, async ({ body, headers }) => {
      try {
        const jobId = await this.transcriptionApi.createJob(
          body,
          headers['idempotency-key'],
        );
        return { status: 202, body: { jobId } };
      } catch (error) {
        if (error instanceof InvalidTranscriptionRequestError) {
          return { status: 400, body: { message: error.message } };
        }
        throw error;
      }
    });
  }

  @TsRestHandler(router.getJob)
  public handleGetJob(): Handler<typeof router.getJob> {
    return tsRestHandler(router.getJob, async ({ params }) => {
      const status = await this.transcriptionApi.getJobStatus(params.jobId);
      return status
        ? { status: 200, body: status }
        : {
            status: 404,
            body: { message: 'Job not found (results expire after an hour)' },
          };
    });
  }

  @TsRestHandler(router.listModels)
  public handleListModels(): Handler<typeof router.listModels> {
    return tsRestHandler(router.listModels, () =>
      Promise.resolve({
        status: 200 as const,
        body: this.transcriptionApi.listModels(),
      }),
    );
  }
}
