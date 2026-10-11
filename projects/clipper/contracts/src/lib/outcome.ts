// Only imports zod, so the tests can load this with Node's type stripping.
import { z } from 'zod';

export const CLIP_CATEGORIES = [
  /** Something that makes people laugh: a bit, a bug, a reaction. */
  'funny',
  /** Winning against the odds. */
  'clutch',
  /** A play that's impressive on its own. */
  'skill',
  /** Losing in a way worth watching. */
  'fail',
  /** Everything going wrong (or right) at once. */
  'chaos',
  'other',
] as const;
export type ClipCategory = (typeof CLIP_CATEGORIES)[number];

export const SEGMENT_LIMITS = {
  minSec: 3,
  maxSec: 60,
  maxSegments: 3,
  maxTitleLength: 100,
};

export const segmentSchema = z.object({
  /** Seconds into the original clip. */
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  title: z.string(),
  category: z.enum(CLIP_CATEGORIES),
  /** 0 to 1: how sure the model is that this is worth posting. */
  confidence: z.number().min(0).max(1),
  /** What happens in it and why it's the moment. */
  reasoning: z.string(),
});
export type Segment = z.infer<typeof segmentSchema>;

export const outcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    /** In the order they happen, never overlapping. */
    segments: segmentSchema.array().min(1).max(SEGMENT_LIMITS.maxSegments),
  }),
  z.object({
    status: z.literal('not_found'),
    reason: z.string(),
  }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

/**
 * What the model is asked to answer with. Flat rather than a union, since that's what structured
 * output handles best; `toOutcome` turns it into an Outcome.
 *
 * Timestamps are "M:SS" strings, not seconds: Gemini places moments in video as MM:SS, and asked
 * for seconds it often writes 1:47 as 147.
 */
export const modelOutputSchema = z.object({
  found: z.boolean(),
  notFoundReason: z.string().optional(),
  segments: z
    .object({
      reasoning: z.string(),
      start: z.string(),
      end: z.string(),
      title: z.string(),
      category: z.enum(CLIP_CATEGORIES),
      confidence: z.number(),
    })
    .array()
    .default([]),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** How far past the end of the media a timestamp can be and still count as the end. */
const END_SLACK_SEC = 2;

/** "1:05", "01:05.5" or "1:02:03" in seconds, or null if it isn't a timestamp. */
export function parseTimestamp(text: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return null;
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  // "1:60" is clear enough, but "1:75" isn't.
  if (Number(seconds) > 60) return null;
  if (match[1] !== undefined && Number(minutes) >= 60) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Seconds as "M:SS", the way the model is asked to write timestamps. */
export function formatTimestamp(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Checks the model's answer and puts its timestamps on the original clip's timeline. Small slips
 * (a segment a bit short, an end just past the media, a confidence out of 100) are fixed; anything
 * that would mean guessing what the model meant is an error, so the caller can ask again.
 *
 * @param mediaDurationSec How long the media the model saw is.
 * @param offsetSec Where that media starts in the original clip (when only its tail was sent).
 */
export function toOutcome(
  output: ModelOutput,
  {
    mediaDurationSec,
    offsetSec,
  }: { mediaDurationSec: number; offsetSec: number },
): { ok: true; outcome: Outcome } | { ok: false; error: string } {
  if (!output.found) {
    return {
      ok: true,
      outcome: {
        status: 'not_found',
        reason: output.notFoundReason?.trim() || 'The model gave no reason.',
      },
    };
  }
  if (output.segments.length === 0) {
    return { ok: false, error: 'found is true but there are no segments' };
  }

  const segments: Segment[] = [];
  for (const raw of output.segments) {
    const span = `${raw.start}-${raw.end}`;
    let startSec = parseTimestamp(raw.start);
    let endSec = parseTimestamp(raw.end);
    if (startSec === null || endSec === null) {
      return { ok: false, error: `segment ${span} isn't in M:SS` };
    }
    if (endSec > mediaDurationSec + END_SLACK_SEC) {
      return {
        ok: false,
        error: `segment ${span} goes past the end of the media, ${formatTimestamp(mediaDurationSec)}`,
      };
    }
    startSec = Math.max(0, startSec);
    endSec = Math.min(mediaDurationSec, endSec);
    if (endSec <= startSec) {
      return { ok: false, error: `segment ${span} ends before it starts` };
    }
    if (endSec - startSec > SEGMENT_LIMITS.maxSec) {
      return {
        ok: false,
        error: `segment ${span} is longer than ${SEGMENT_LIMITS.maxSec}s`,
      };
    }
    // Too short: grow it forward (to take in the reaction), then back if it hits the end.
    if (endSec - startSec < SEGMENT_LIMITS.minSec) {
      endSec = Math.min(mediaDurationSec, startSec + SEGMENT_LIMITS.minSec);
      startSec = Math.max(0, endSec - SEGMENT_LIMITS.minSec);
    }

    const confidence =
      raw.confidence > 1 ? raw.confidence / 100 : raw.confidence;
    segments.push({
      startSec: round(startSec + offsetSec),
      endSec: round(endSec + offsetSec),
      title: raw.title.trim().slice(0, SEGMENT_LIMITS.maxTitleLength),
      category: raw.category,
      confidence: Math.min(1, Math.max(0, confidence)),
      reasoning: raw.reasoning.trim(),
    });
  }

  const kept = segments
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, SEGMENT_LIMITS.maxSegments)
    .sort((a, b) => a.startSec - b.startSec);
  for (let i = 1; i < kept.length; i++) {
    const previous = kept[i - 1];
    const current = kept[i];
    if (previous && current && current.startSec < previous.endSec) {
      return {
        ok: false,
        error: `segments ${previous.startSec}s-${previous.endSec}s and ${current.startSec}s-${current.endSec}s overlap`,
      };
    }
  }
  return { ok: true, outcome: { status: 'found', segments: kept } };
}

function round(seconds: number) {
  return Math.round(seconds * 10) / 10;
}
