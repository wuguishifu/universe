// Run with `nx test youtube-music-service` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanTitle, trackMetadata } from './metadata.ts';

describe('trackMetadata', () => {
  it("uses YouTube Music's metadata when there is some", () => {
    assert.deepEqual(
      trackMetadata({
        id: 'abc',
        title: 'Song (Official Audio)',
        track: 'Song',
        artists: ['Artist', 'Guest'],
        album: 'Album',
        channel: 'Artist - Topic',
        duration: 201,
      }),
      {
        title: 'Song',
        artist: 'Artist, Guest',
        album: 'Album',
        durationSec: 201,
      },
    );
  });

  it('falls back from artists to artist to the channel', () => {
    assert.equal(
      trackMetadata({ id: 'abc', track: 'Song', artist: 'Solo' }).artist,
      'Solo',
    );
    assert.equal(
      trackMetadata({ id: 'abc', track: 'Song', channel: 'Band - Topic' })
        .artist,
      'Band',
    );
  });

  it('splits "Artist - Title" titles', () => {
    assert.deepEqual(
      trackMetadata({
        id: 'abc',
        title: 'Daft Punk - Something About Us (Official Video)',
        channel: 'Daft Punk',
        duration: 232.5,
      }),
      {
        title: 'Something About Us',
        artist: 'Daft Punk',
        album: null,
        durationSec: 232.5,
      },
    );
  });

  it('uses the channel as the artist otherwise', () => {
    assert.deepEqual(
      trackMetadata({
        id: 'abc',
        title: 'Lofi beats [HD]',
        uploader: 'ChillVEVO',
      }),
      { title: 'Lofi beats', artist: 'Chill', album: null, durationSec: null },
    );
  });

  it('falls back to the video ID when there is no title', () => {
    assert.equal(trackMetadata({ id: 'abc' }).title, 'abc');
  });
});

describe('cleanTitle', () => {
  it('drops what describes the video', () => {
    for (const [input, expected] of [
      ['Song (Official Music Video)', 'Song'],
      ['Song [Official Video]', 'Song'],
      ['Song (Official Audio)', 'Song'],
      ['Song (Lyrics)', 'Song'],
      ['Song (Lyric Video)', 'Song'],
      ['Song (Official Visualizer)', 'Song'],
      ['Song [M/V]', 'Song'],
      ['Song (Official HD Video)', 'Song'],
      ['Song (4K)', 'Song'],
      ['Song (Official Video Remastered)', 'Song'],
      ['Song [Official Music Video] [HD]', 'Song'],
      ['GANGNAM STYLE(강남스타일) M/V', 'GANGNAM STYLE(강남스타일)'],
      ['Song MV', 'Song'],
    ] satisfies [string, string][]) {
      assert.equal(cleanTitle(input), expected, input);
    }
  });

  it('keeps what describes the song', () => {
    for (const title of [
      'Song (feat. Someone)',
      'Song (Remix)',
      'Song (Live at Wembley)',
      'Song [Acoustic]',
    ]) {
      assert.equal(cleanTitle(title), title);
    }
  });

  it('never leaves nothing', () => {
    assert.equal(cleanTitle('(Official Video)'), '(Official Video)');
  });
});
