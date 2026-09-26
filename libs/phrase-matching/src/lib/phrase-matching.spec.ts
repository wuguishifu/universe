// Run with `nx test phrase-matching` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findPhraseMatches, normalizeText } from './phrase-matching.ts';

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
