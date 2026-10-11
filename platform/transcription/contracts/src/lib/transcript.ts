import z from 'zod';

export const MAX_INLINE_AUDIO_BYTES = 3 * 1024 * 1024;
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
  beamSize: z.number().max(5).min(0).optional(),
  /**
   * Also return each word's timing (`transcript.words`), e.g. to cut a phrase out of the audio.
   * Costs about 15% more transcription time, so it's off unless asked for.
   */
  wordTimestamps: z.boolean().optional(),
  /**
   * Work out who's speaking and label `segments` and `words` with a `speaker`, for audio with
   * several voices on one track (e.g. a Discord call). Implies `wordTimestamps`. Giving a range of
   * speaker counts helps a lot: without one, people who sound alike tend to be merged. Fails on a
   * worker without a diarizer.
   */
  diarize: z
    .object({
      minSpeakers: z.number().int().min(1).optional(),
      maxSpeakers: z.number().int().min(1).optional(),
    })
    .refine(
      ({ minSpeakers, maxSpeakers }) =>
        !minSpeakers || !maxSpeakers || minSpeakers <= maxSpeakers,
      { message: 'minSpeakers must be at most maxSpeakers' },
    )
    .optional(),
});
export type TranscriptionOptions = z.infer<typeof transcriptionOptionsSchema>;

export const transcriptSegmentSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
  /**
   * Only when the request set `diarize`: who said it, as a label like "A" that's the same
   * throughout this transcript (but unrelated to other transcripts' labels).
   */
  speaker: z.string().optional(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  text: z.string(),
  /**
   * Usually a sentence or more each; whisper decides where they split. With `diarize`, a sentence
   * or less each, since they also split wherever the speaker changes.
   */
  segments: transcriptSegmentSchema.array(),
  /** Each word with its timing. Only there when the request set `wordTimestamps` or `diarize`. */
  words: transcriptSegmentSchema.array().optional(),
  language: z.string(),
  model: z.string(),
  audioDurationMs: z.number(),
});
export type Transcript = z.infer<typeof transcriptSchema>;
