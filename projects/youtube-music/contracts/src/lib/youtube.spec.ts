// Run with `nx test youtube-music-contracts` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findYoutubeLink, parseYoutubeUrl } from './youtube.ts';

const ID = 'dQw4w9WgXcQ';
const LIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI';

describe('parseYoutubeUrl', () => {
  it('reads videos from every link shape', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&t=42s`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}&si=abc`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `http://www.youtube.com/watch?v=${ID}`,
    ]) {
      assert.deepEqual(parseYoutubeUrl(url), { kind: 'video', videoId: ID });
    }
  });

  it('treats a video watched in a playlist as the video', () => {
    assert.deepEqual(
      parseYoutubeUrl(`https://www.youtube.com/watch?v=${ID}&list=${LIST}`),
      { kind: 'video', videoId: ID },
    );
  });

  it('reads playlists', () => {
    assert.deepEqual(
      parseYoutubeUrl(`https://www.youtube.com/playlist?list=${LIST}`),
      { kind: 'playlist', playlistId: LIST },
    );
    assert.deepEqual(
      parseYoutubeUrl(
        'https://music.youtube.com/playlist?list=OLAK5uy_n2sIsF7uEhw0EBm6yBnQ1UNPFsAHrEoAM',
      ),
      {
        kind: 'playlist',
        playlistId: 'OLAK5uy_n2sIsF7uEhw0EBm6yBnQ1UNPFsAHrEoAM',
      },
    );
  });

  it('rejects everything else', () => {
    for (const url of [
      'not a url',
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/@somechannel',
      'https://www.youtube.com/playlist',
      `ftp://youtube.com/watch?v=${ID}`,
    ]) {
      assert.equal(parseYoutubeUrl(url), null, url);
    }
  });
});

describe('findYoutubeLink', () => {
  it('finds the link in shared text', () => {
    assert.deepEqual(
      findYoutubeLink(`Listen to this https://youtu.be/${ID}?si=x it's great`),
      { kind: 'video', videoId: ID },
    );
  });

  it('skips links that are not YouTube', () => {
    assert.deepEqual(
      findYoutubeLink(
        `https://example.com/a and https://www.youtube.com/watch?v=${ID}`,
      ),
      { kind: 'video', videoId: ID },
    );
    assert.equal(findYoutubeLink('nothing here'), null);
  });
});
