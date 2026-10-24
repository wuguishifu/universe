// Run with `nx test phrase-matching` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findPhraseMatches,
  findTimedPhraseMatches,
  normalizeText,
} from './phrase-matching.ts';

describe('normalizeText', () => {
  it('lowercases, strips punctuation and apostrophes, and collapses whitespace', () => {
    assert.equal(normalizeText("  I DON'T   know... "), 'i dont know');
  });

  it('treats curly apostrophes like straight ones', () => {
    assert.equal(normalizeText('I don’t know'), 'i dont know');
  });

  it('strips whisper annotations', () => {
    assert.equal(normalizeText('[BLANK_AUDIO] (laughs) okay'), 'okay');
  });
});

describe('findPhraseMatches', () => {
  it('matches regardless of apostrophes and punctuation', () => {
    assert.deepEqual(
      findPhraseMatches('Honestly, I dont know!', ["I don't know"]),
      [{ phrase: "I don't know", count: 1 }],
    );
  });

  it('counts repeated occurrences, including back-to-back ones', () => {
    assert.deepEqual(findPhraseMatches('no no no, I said no', ['no']), [
      { phrase: 'no', count: 4 },
    ]);
  });

  it('only matches whole words', () => {
    assert.deepEqual(findPhraseMatches('That is unlike him', ['like']), []);
  });

  it('returns only phrases that matched', () => {
    assert.deepEqual(
      findPhraseMatches('I mean, literally', ['literally', "I don't know"]),
      [{ phrase: 'literally', count: 1 }],
    );
  });

  it('ignores phrases that normalize to nothing', () => {
    assert.deepEqual(findPhraseMatches('anything', ['...']), []);
  });
});

describe('findTimedPhraseMatches', () => {
  const segments = [
    { startMs: 0, endMs: 1000, text: 'Honestly, I' },
    { startMs: 1000, endMs: 2000, text: "don't know." },
    { startMs: 2000, endMs: 2500, text: '[BLANK_AUDIO]' },
    { startMs: 2500, endMs: 4000, text: 'No, no. I dont know' },
  ];

  it('gives each occurrence the timing of the segments it was said in', () => {
    assert.deepEqual(findTimedPhraseMatches(segments, ["I don't know"]), [
      {
        phrase: "I don't know",
        count: 2,
        clips: [
          { startMs: 0, endMs: 2000 },
          { startMs: 2500, endMs: 4000 },
        ],
      },
    ]);
  });

  it('gives repeats within a segment a clip each', () => {
    assert.deepEqual(findTimedPhraseMatches(segments, ['no']), [
      {
        phrase: 'no',
        count: 2,
        clips: [
          { startMs: 2500, endMs: 4000 },
          { startMs: 2500, endMs: 4000 },
        ],
      },
    ]);
  });

  it('counts the same as findPhraseMatches on the joined text', () => {
    const phrases = ["I don't know", 'no', 'honestly', 'missing'];
    const text = segments.map(({ text }) => text).join(' ');
    assert.deepEqual(
      findTimedPhraseMatches(segments, phrases).map(({ phrase, count }) => ({
        phrase,
        count,
      })),
      findPhraseMatches(text, phrases),
    );
  });
});
