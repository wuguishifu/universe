import z from 'zod';
import { c } from '../contract';
import {
  errorResponseSchema,
  idempotencyHeadersSchema,
  transcriptionJobStatusSchema,
  transcriptionRequestSchema,
  transcriptSchema,
} from '../schemas';

export const transcriptionRouter = c.router({
  /**
   * Transcribes short audio and responds with the transcript. Runs on the interactive lane,
   * so it never waits behind long batch jobs. Use `createJob` for anything over ~a minute.
   */
  transcribe: {
    method: 'POST',
    path: '/transcriptions',
    headers: idempotencyHeadersSchema,
    body: transcriptionRequestSchema,
    responses: {
      200: transcriptSchema,
      400: errorResponseSchema,
      /** The audio couldn't be decoded or transcribed. Retrying won't help. */
      422: errorResponseSchema,
      /** Still queued/running when the server stopped waiting. Retry with the same key. */
      504: errorResponseSchema,
    },
  },

  /** Queues long audio on the batch lane. Poll `getJob` for the result. */
  createJob: {
    method: 'POST',
    path: '/transcription-jobs',
    headers: idempotencyHeadersSchema,
    body: transcriptionRequestSchema,
    responses: {
      202: z.object({ jobId: z.string() }),
      400: errorResponseSchema,
    },
  },

  /** Results are kept for an hour after a job finishes. */
  getJob: {
    method: 'GET',
    path: '/transcription-jobs/:jobId',
    pathParams: z.object({ jobId: z.string() }),
    responses: {
      200: transcriptionJobStatusSchema,
      404: errorResponseSchema,
    },
  },

  listModels: {
    method: 'GET',
    path: '/models',
    responses: {
      200: z.object({
        defaultModel: z.string(),
        models: z.array(z.string()),
        vadAvailable: z.boolean(),
      }),
    },
  },
});
