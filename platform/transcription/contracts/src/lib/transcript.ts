import z from 'zod';

export const MAX_INLINE_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_PROMPT_LENGTH = 1000;

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
  model: z.string().min(1).optional(),
  prompt: z.string().max(MAX_PROMPT_LENGTH).optional(),
  beamSize: z.number().optional(),
});
export type TranscriptionOptions = z.infer<typeof transcriptionOptionsSchema>;

export const transcriptSegmentSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  text: z.string(),
  segments: transcriptSegmentSchema.array(),
  language: z.string(),
  model: z.string(),
  audioDurationMs: z.number(),
});
export type Transcript = z.infer<typeof transcriptSchema>;
