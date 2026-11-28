// Run with `nx test web-auth` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { safeRedirectPath } from '../src/lib/paths.ts';

const FALLBACK = '/home';

describe('safeRedirectPath', () => {
  it('keeps paths on this site', () => {
    for (const path of ['/', '/album', '/album/2024?page=2#top', '/a/b/']) {
      assert.equal(safeRedirectPath(path, FALLBACK), path);
    }
  });

  it('falls back for anything that is not a string path', () => {
    for (const value of [undefined, null, 42, ['/album'], '', 'album']) {
      assert.equal(safeRedirectPath(value, FALLBACK), FALLBACK);
    }
  });

  it('rejects other sites', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
    ]) {
      assert.equal(safeRedirectPath(value, FALLBACK), FALLBACK, value);
    }
  });

  // The URL parser drops tabs and newlines, so these become //evil.example in a browser.
  it('rejects control characters that browsers strip', () => {
    for (const value of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r\n/evil.example',
      '/album\u0000',
      '/album\u007f',
    ]) {
      assert.equal(safeRedirectPath(value, FALLBACK), FALLBACK, value);
    }
  });

  it('returns the path as the browser will read it', () => {
    assert.equal(safeRedirectPath('/a/../album', FALLBACK), '/album');
  });
});
