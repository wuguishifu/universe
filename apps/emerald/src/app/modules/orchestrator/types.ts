import { z } from 'zod';

export const whisperSegmentSchema = z.object({
  timestamps: z.object({ from: z.string(), to: z.string() }),
  offsets: z.object({ from: z.number(), to: z.number() }),
  text: z.string(),
});
export type WhisperSegment = z.infer<typeof whisperSegmentSchema>;

export const whisperOutputSchema = z.object({
  transcription: whisperSegmentSchema.array(),
});
export type WhisperOutput = z.infer<typeof whisperOutputSchema>;

export const transcriptSegmentSchema = z.object({
  speaker: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
