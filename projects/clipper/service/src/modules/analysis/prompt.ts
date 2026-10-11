import {
  CLIP_CATEGORIES,
  formatTimestamp,
  type RunOptions,
  SEGMENT_LIMITS,
} from '@projects/clipper-contracts';

/**
 * Stored on every run. Bump it whenever the prompt or answer schema changes in a way that could
 * change results, so runs before and after aren't compared as if only their options differed.
 */
export const PROMPT_VERSION = 2;

export function systemInstruction(options: RunOptions): string {
  const sees =
    options.media === 'audio'
      ? 'You only get the audio of the clip, not the video, so judge from what you hear.'
      : 'You get the video and its audio.';

  return `You watch video game clips and find the moments worth posting.

The clips are recorded with Medal: when something happens, the player presses a hotkey and Medal saves the last minute or two. So the moment that made them press it is usually near the end, though not always, and a clip can have more than one.

The audio is the game, the player's microphone and their friends on Discord, mixed together. Voices are often the best sign of a moment: laughing, yelling, someone saying "clip that", a sudden silence and then screaming. ${sees}

Find up to ${SEGMENT_LIMITS.maxSegments} moments that are funny, impressive, or otherwise worth sharing with friends. For each one:
- start and end: timestamps in M:SS from the start of the media you're given, like "1:05" for 65 seconds in. Start a few seconds before the moment, so someone watching gets the setup. End once the payoff and the reaction to it are over, not mid-laugh. Each moment is ${SEGMENT_LIMITS.minSec} to ${SEGMENT_LIMITS.maxSec} seconds long, usually 8 to 30. Moments must not overlap; if two are close together, make them one.
- title: a short, casual title the player could post it with, under 60 characters. Write it like a gamer posting a clip, not like a headline. No hashtags.
- category: one of ${CLIP_CATEGORIES.join(', ')}.
- confidence: 0 to 1, how sure you are that it's worth posting. 0.8 or more means it clearly is; under 0.4 means it's a stretch.
- reasoning: one or two sentences on what happens, pointing to what you ${options.media === 'audio' ? 'hear' : 'see and hear'}.

If nothing in the clip is worth posting (an accidental clip, a menu, nothing happening), set found to false and say why in notFoundReason. Don't stretch a dull clip into a moment.`;
}

export function clipContext({
  game,
  clipDurationSec,
  mediaDurationSec,
  offsetSec,
  instructions,
}: {
  game?: string;
  clipDurationSec: number;
  mediaDurationSec: number;
  offsetSec: number;
  instructions?: string;
}): string {
  const lines = [
    game
      ? `Game: ${game} (Medal's name for it, which may have its spaces removed).`
      : "The game isn't known.",
    offsetSec > 0
      ? `This is the last ${formatTimestamp(mediaDurationSec)} of a ${formatTimestamp(clipDurationSec)} clip. Give timestamps from the start of what you were given, from 0:00 to ${formatTimestamp(mediaDurationSec)}.`
      : `The clip is ${formatTimestamp(clipDurationSec)} long, so timestamps go from 0:00 to ${formatTimestamp(clipDurationSec)}.`,
  ];
  if (instructions) {
    lines.push(
      '',
      `The player's notes on what they're looking for:\n${instructions}`,
    );
  }
  return lines.join('\n');
}

/**
 * The answer's shape, as JSON Schema for Gemini's structured output. Checked again on the way in
 * with modelOutputSchema. Reasoning comes before the timestamps so the model describes the moment
 * before placing it.
 */
export const MODEL_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      maxItems: SEGMENT_LIMITS.maxSegments,
      items: {
        type: 'object',
        properties: {
          reasoning: { type: 'string' },
          start: { type: 'string', description: 'M:SS, e.g. "1:05"' },
          end: { type: 'string', description: 'M:SS, e.g. "1:22"' },
          title: { type: 'string' },
          category: { type: 'string', enum: [...CLIP_CATEGORIES] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: [
          'reasoning',
          'start',
          'end',
          'title',
          'category',
          'confidence',
        ],
      },
    },
    found: { type: 'boolean' },
    notFoundReason: {
      type: 'string',
      description: 'Why nothing is worth posting. Only when found is false.',
    },
  },
  required: ['segments', 'found'],
};

/** Asks again after an answer that couldn't be used, saying what was wrong with it. */
export function retryPrompt(problem: string): string {
  return `That answer can't be used: ${problem}. Answer again, fixing that. Timestamps are M:SS from the start of the media, and no later than its end.`;
}
