/** Longest tracked phrase allowed, shared by the slash command options and the backend. */
export const MAX_PHRASE_LENGTH = 100;

export interface PhraseMatch {
  phrase: string;
  count: number;
}

/**
 * Normalizes text so that transcripts and tracked phrases compare loosely:
 * case, punctuation, apostrophes ("don't" vs "dont"), accents and whitespace are ignored.
 * Whisper annotations like "[BLANK_AUDIO]" or "(laughs)" are stripped.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’ʼ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Counts whole-word, non-overlapping occurrences of each tracked phrase in the transcript. */
export function findPhraseMatches(
  transcript: string,
  phrases: readonly string[],
): PhraseMatch[] {
  const haystack = normalizeText(transcript);
  const matches: PhraseMatch[] = [];

  for (const phrase of phrases) {
    const needle = normalizeText(phrase);
    if (!needle) continue;

    // Lookarounds (rather than consuming the surrounding spaces) so back-to-back repeats all count.
    const pattern = new RegExp(`(?<=^| )${escapeRegExp(needle)}(?= |$)`, 'g');
    const count = haystack.match(pattern)?.length ?? 0;
    if (count > 0) matches.push({ phrase, count });
  }

  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
