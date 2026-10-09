import { type TranscriptSegment } from '@platform/transcription-contracts';

export interface WhisperToken {
  text: string;
  offsets: { from: number; to: number };
  /** When the token starts according to DTW, in 10ms units; -1 when whisper didn't run DTW. */
  t_dtw: number;
}

/** Control tokens like [_BEG_] and [_TT_340], which aren't speech. */
const CONTROL_TOKEN = /^\[_.*\]$/;
const HAS_WORD_CHARACTERS = /[\p{L}\p{N}]/u;

/**
 * Groups whisper's tokens into words with their timings. A token starting with a space starts a
 * word, and the rest (e.g. "'t" after " don") continue it. Punctuation stays in the word's text but
 * doesn't extend its timing.
 *
 * With DTW, a token lasts from its own time to the next token's (as in OpenAI's whisper). Without,
 * whisper's own per-token offsets are used, which are often a word or so off on real speech.
 */
export function tokensToWords(
  tokens: readonly WhisperToken[],
): TranscriptSegment[] {
  const speech = tokens.filter(({ text }) => !CONTROL_TOKEN.test(text));
  const useDtw = speech.length > 0 && speech.every(({ t_dtw }) => t_dtw >= 0);
  const timing = (
    token: WhisperToken,
    index: number,
  ): { from: number; to: number } => {
    if (!useDtw) return token.offsets;
    const from = token.t_dtw * 10;
    const next = speech[index + 1];
    return {
      from,
      to: next ? next.t_dtw * 10 : Math.max(from, token.offsets.to),
    };
  };

  const words: TranscriptSegment[] = [];
  speech.forEach((token, index) => {
    const { text } = token;
    const { from, to } = timing(token, index);
    const current = words[words.length - 1];
    if (!current || text.startsWith(' ')) {
      if (text.trim())
        words.push({ startMs: from, endMs: to, text: text.trim() });
      return;
    }
    current.text += text;
    if (HAS_WORD_CHARACTERS.test(text)) {
      current.endMs = Math.max(current.endMs, to);
    }
  });
  return words;
}
