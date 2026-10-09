import { type TranscriptSegment } from '@platform/transcription-contracts';

export interface WhisperToken {
  text: string;
  offsets: { from: number; to: number };
}

/** Control tokens like [_BEG_] and [_TT_340], which aren't speech. */
const CONTROL_TOKEN = /^\[_.*\]$/;
const HAS_WORD_CHARACTERS = /[\p{L}\p{N}]/u;

/**
 * Groups whisper's tokens into words with their timings. A token starting with a space starts a
 * word, and the rest (e.g. "'t" after " don") continue it. Punctuation stays in the word's text but
 * doesn't extend its timing, since whisper gives it the gap until the next word.
 */
export function tokensToWords(
  tokens: readonly WhisperToken[],
): TranscriptSegment[] {
  const words: TranscriptSegment[] = [];
  for (const { text, offsets } of tokens) {
    if (CONTROL_TOKEN.test(text)) continue;
    const current = words[words.length - 1];
    if (!current || text.startsWith(' ')) {
      if (!text.trim()) continue;
      words.push({
        startMs: offsets.from,
        endMs: offsets.to,
        text: text.trim(),
      });
      continue;
    }
    current.text += text;
    if (HAS_WORD_CHARACTERS.test(text)) {
      current.endMs = Math.max(current.endMs, offsets.to);
    }
  }
  return words;
}
