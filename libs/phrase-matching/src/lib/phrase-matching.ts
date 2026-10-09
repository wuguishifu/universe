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

    const count = haystack.match(phrasePattern(needle))?.length ?? 0;
    if (count > 0) matches.push({ phrase, count });
  }

  return matches;
}

/** A timed piece of a transcript, e.g. one of whisper's segments. */
export interface TimedText {
  startMs: number;
  endMs: number;
  text: string;
}

export interface PhraseClip {
  startMs: number;
  endMs: number;
}

export interface TimedPhraseMatch extends PhraseMatch {
  /** Where each occurrence was said, one per `count`. */
  clips: PhraseClip[];
}

/**
 * findPhraseMatches over a transcript split into timed pieces, also returning when each occurrence
 * was said: from the start of the first piece it touches to the end of the last, so a phrase
 * spanning two segments covers both. The clips are only as precise as the pieces' timings.
 */
export function findTimedPhraseMatches(
  pieces: readonly TimedText[],
  phrases: readonly string[],
): TimedPhraseMatch[] {
  // Normalizing each piece and joining with spaces gives the same haystack as normalizing the
  // whole transcript, while recording which characters came from which piece.
  const spans: { start: number; end: number; piece: TimedText }[] = [];
  let haystack = '';
  for (const piece of pieces) {
    const text = normalizeText(piece.text);
    if (!text) continue;
    if (haystack) haystack += ' ';
    spans.push({
      start: haystack.length,
      end: haystack.length + text.length,
      piece,
    });
    haystack += text;
  }

  const matches: TimedPhraseMatch[] = [];
  for (const phrase of phrases) {
    const needle = normalizeText(phrase);
    if (!needle) continue;

    const clips: PhraseClip[] = [];
    for (const { index } of haystack.matchAll(phrasePattern(needle))) {
      const end = index + needle.length;
      // A match starts and ends on a word, so both always exist.
      const first = spans.find((span) => span.end > index);
      const last = spans.filter((span) => span.start < end).pop();
      if (!first || !last) continue;
      clips.push({ startMs: first.piece.startMs, endMs: last.piece.endMs });
    }
    if (clips.length > 0) matches.push({ phrase, count: clips.length, clips });
  }

  return matches;
}

/** Matches a normalized phrase as whole words. */
function phrasePattern(needle: string): RegExp {
  // Lookarounds (rather than consuming the surrounding spaces) so back-to-back repeats all count.
  return new RegExp(`(?<=^| )${escapeRegExp(needle)}(?= |$)`, 'g');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
