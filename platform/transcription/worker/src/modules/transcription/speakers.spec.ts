// Run with `nx test transcription-worker` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assignSpeakers, segmentsBySpeaker } from './speakers.ts';

const word = (text: string, startMs: number, endMs: number) => ({
  text,
  startMs,
  endMs,
});
const turn = (speaker: string, startMs: number, endMs: number) => ({
  speaker,
  startMs,
  endMs,
});

describe('assignSpeakers', () => {
  it('labels speakers A, B, ... in the order they first speak', () => {
    const words = [
      word('hi', 0, 400),
      word('hey', 1000, 1400),
      word('yo', 2000, 2400),
    ];
    const turns = [
      turn('SPEAKER_07', 0, 500),
      turn('SPEAKER_02', 900, 1500),
      turn('SPEAKER_07', 1900, 2500),
    ];
    assert.deepEqual(
      assignSpeakers(words, turns).map(({ speaker }) => speaker),
      ['A', 'B', 'A'],
    );
  });

  it('keeps the current speaker through an overlap until their sentence ends', () => {
    // B talks over A from 500ms; A finishes their sentence, then B's next sentence is B's.
    const words = [
      word('read', 0, 300),
      word('the', 300, 500),
      word('bottom', 500, 800),
      word('right.', 800, 1100),
      word('Bottom', 1300, 1600),
      word('right?', 1600, 1900),
    ];
    const turns = [turn('x', 0, 1150), turn('y', 500, 2000)];
    assert.deepEqual(
      assignSpeakers(words, turns).map(({ speaker }) => speaker),
      ['A', 'A', 'A', 'A', 'B', 'B'],
    );
  });

  it("doesn't let a word that spans a pause reach the next speaker's turn", () => {
    // With DTW a word lasts until the next one starts, so "Okay" spans the pause.
    const words = [word('Okay', 0, 3000), word('sure', 3000, 3300)];
    const turns = [turn('x', 0, 400), turn('y', 2900, 3400)];
    assert.deepEqual(
      assignSpeakers(words, turns).map(({ speaker }) => speaker),
      ['A', 'B'],
    );
  });

  it('gives words outside every turn to the nearest one', () => {
    const words = [word('um', 5000, 5100)];
    const turns = [turn('x', 0, 1000), turn('y', 5600, 6000)];
    assert.equal(assignSpeakers(words, turns)[0]?.speaker, 'A');
  });

  it('leaves words unlabeled without any turns', () => {
    assert.equal(
      assignSpeakers([word('hi', 0, 100)], [])[0]?.speaker,
      undefined,
    );
  });
});

describe('segmentsBySpeaker', () => {
  it('splits on speaker changes, sentence ends and long pauses', () => {
    const words = [
      { ...word('Is', 0, 200), speaker: 'A' },
      { ...word('it?', 200, 500), speaker: 'A' },
      { ...word('Yes', 600, 800), speaker: 'A' },
      { ...word('read', 900, 1100), speaker: 'B' },
      { ...word('it', 1100, 1300), speaker: 'B' },
      { ...word('again', 3000, 3300), speaker: 'B' },
    ];
    assert.deepEqual(segmentsBySpeaker(words), [
      { text: 'Is it?', startMs: 0, endMs: 500, speaker: 'A' },
      { text: 'Yes', startMs: 600, endMs: 800, speaker: 'A' },
      { text: 'read it', startMs: 900, endMs: 1300, speaker: 'B' },
      { text: 'again', startMs: 3000, endMs: 3300, speaker: 'B' },
    ]);
  });
});
