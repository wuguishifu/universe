import type { TranscriptSegment } from '@platform/transcription-contracts';

/** A stretch of time one speaker is talking, from the diarizer. Turns overlap when people talk over each other. */
export interface SpeakerTurn {
  startMs: number;
  endMs: number;
  speaker: string;
}

/** Word timings are a little off, so a turn counts as overlapping a word this close to it. */
const OVERLAP_SLACK_MS = 100;
/**
 * With DTW a word lasts until the next one starts, so the last word before a pause spans it.
 * A word is taken to be spoken for at most this long, so a pause doesn't drag it into the next
 * speaker's turn or hide the pause from segmenting.
 */
const MAX_WORD_MS = 1000;
/** A pause this long starts a new segment even when the same person keeps talking. */
const SEGMENT_GAP_MS = 1500;
const SENTENCE_END = /[.?!]["')\]]*$/;

/**
 * Labels each word with who said it: the speaker whose turns overlap it most. Where turns overlap
 * (people talking over each other), a word stays with the previous word's speaker if they're one
 * of them, since whoever has the floor usually keeps it. Words outside every turn go to the
 * nearest one. Speakers are relabeled "A", "B", ... in the order they first speak.
 */
export function assignSpeakers(
  words: readonly TranscriptSegment[],
  turns: readonly SpeakerTurn[],
): TranscriptSegment[] {
  if (turns.length === 0) return words.map((word) => ({ ...word }));

  const labels = new Map<string, string>();
  const label = (speaker: string) => {
    let existing = labels.get(speaker);
    if (!existing) {
      existing = speakerLabel(labels.size);
      labels.set(speaker, existing);
    }
    return existing;
  };

  let previous: string | undefined;
  return words.map((word) => {
    const speaker = speakerFor(word, turns, previous);
    previous = SENTENCE_END.test(word.text) ? undefined : speaker;
    return { ...word, speaker: label(speaker) };
  });
}

function speakerFor(
  word: TranscriptSegment,
  turns: readonly SpeakerTurn[],
  previous: string | undefined,
): string {
  const from = word.startMs - OVERLAP_SLACK_MS;
  const to = speechEndMs(word) + OVERLAP_SLACK_MS;

  const overlaps = new Map<string, number>();
  for (const turn of turns) {
    const overlap = Math.min(turn.endMs, to) - Math.max(turn.startMs, from);
    if (overlap > 0) {
      overlaps.set(turn.speaker, (overlaps.get(turn.speaker) ?? 0) + overlap);
    }
  }

  if (previous !== undefined && overlaps.has(previous)) return previous;
  let best: [string, number] | undefined;
  for (const entry of overlaps) {
    if (!best || entry[1] > best[1]) best = entry;
  }
  if (best) return best[0];

  const distance = (turn: SpeakerTurn) =>
    Math.max(turn.startMs - word.startMs, word.startMs - turn.endMs, 0);
  return turns.reduce((nearest, turn) =>
    distance(turn) < distance(nearest) ? turn : nearest,
  ).speaker;
}

/** When a word's speech likely ends, since with DTW its end runs on through any pause after it. */
function speechEndMs(word: TranscriptSegment): number {
  return Math.min(word.endMs, word.startMs + MAX_WORD_MS);
}

/** "A" through "Z", then "AA", "AB", ... */
function speakerLabel(index: number): string {
  const letter = String.fromCharCode(65 + (index % 26));
  return index < 26
    ? letter
    : speakerLabel(Math.floor(index / 26) - 1) + letter;
}

/**
 * Groups speaker-labeled words into segments: a new one starts when the speaker changes, after the
 * end of a sentence, or after a long pause.
 */
export function segmentsBySpeaker(
  words: readonly TranscriptSegment[],
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let lastWord: TranscriptSegment | undefined;
  for (const word of words) {
    const current = segments[segments.length - 1];
    if (
      !current ||
      !lastWord ||
      current.speaker !== word.speaker ||
      SENTENCE_END.test(lastWord.text) ||
      word.startMs - speechEndMs(lastWord) >= SEGMENT_GAP_MS
    ) {
      segments.push({ ...word });
    } else {
      current.text += ` ${word.text}`;
      current.endMs = Math.max(current.endMs, word.endMs);
    }
    lastWord = word;
  }
  return segments;
}
