import z from 'zod';

/** Inline audio is capped so a request (and the queued job holding it) stays small. */
export const MAX_INLINE_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Where the audio comes from. Any format ffmpeg can decode is accepted.
 * - `inline`: base64 bytes in the request. Meant for short clips (e.g. Discord utterances).
 * - `s3`: an object in Garage that tungsten reads with its own credentials. Meant for long audio.
 */
export const audioSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inline'),
    data: z
      .base64()
      .refine((data) => (data.length * 3) / 4 <= MAX_INLINE_AUDIO_BYTES, {
        message: `Inline audio must be at most ${MAX_INLINE_AUDIO_BYTES} bytes`,
      }),
  }),
  z.object({
    type: z.literal('s3'),
    bucket: z.string().min(1),
    key: z.string().min(1),
  }),
]);
export type AudioSource = z.infer<typeof audioSourceSchema>;

export const transcriptionOptionsSchema = z.object({
  /** One of the models from `GET /api/models`. Defaults to the server's default model. */
  model: z.string().min(1).optional(),
  /** ISO 639-1 code, or `auto` to detect. English-only (`*.en`) models ignore this. */
  language: z.string().min(2).default('en'),
  /** Biases the decoder toward expected vocabulary, e.g. names or "[laughter]". */
  prompt: z.string().max(1000).optional(),
  /** Skip non-speech with voice activity detection. Requires the server to have a VAD model. */
  vad: z.boolean().default(false),
});
export type TranscriptionOptions = z.infer<typeof transcriptionOptionsSchema>;

export const transcriptionRequestSchema = z.object({
  source: audioSourceSchema,
  options: transcriptionOptionsSchema.default({ language: 'en', vad: false }),
});
export type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;

export const transcriptSegmentSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  /** All segments joined; whitespace-normalized. */
  text: z.string(),
  segments: z.array(transcriptSegmentSchema),
  /** Detected (or requested) language. */
  language: z.string(),
  model: z.string(),
  audioDurationMs: z.number(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const transcriptionJobStatusSchema = z.discriminatedUnion('status', [
  z.object({ jobId: z.string(), status: z.literal('queued') }),
  z.object({ jobId: z.string(), status: z.literal('processing') }),
  z.object({
    jobId: z.string(),
    status: z.literal('completed'),
    transcript: transcriptSchema,
  }),
  z.object({
    jobId: z.string(),
    status: z.literal('failed'),
    error: z.string(),
  }),
]);
export type TranscriptionJobStatus = z.infer<
  typeof transcriptionJobStatusSchema
>;

export const errorResponseSchema = z.object({ message: z.string() });

/**
 * Makes retries safe: repeating a request with the same key returns the original job's
 * result instead of transcribing again. Must be unique across all callers, so prefix it
 * with the calling app, e.g. `discord-bot:<job id>`.
 */
export const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().min(1).max(200).optional(),
});
