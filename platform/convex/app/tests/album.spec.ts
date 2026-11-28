// Run with `nx test convex-app` (Node's built-in test runner; Node strips the types). Lives outside
// convex/ so Convex doesn't try to bundle it.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachmentDisposition,
  createSigner,
  currentSigningWindow,
  encodeKey,
  isAcceptableSigningWindow,
  SIGNING_WINDOW_MS,
  signUrl,
} from '../convex/album/signing.ts';
import { basename, slugify, uniqueSlug } from '../convex/album/slugs.ts';

const CONFIG = {
  endpoint: 'https://s3-public.example.dev',
  region: 'garage',
  accessKeyId: 'GKexample',
  secretAccessKey: 'secret',
};

describe('signUrl', () => {
  it("matches AWS's presigned URL example", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = await signUrl(
      new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      {
        region: 'us-east-1',
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        datetime: '20130524T000000Z',
        expiresSeconds: 86400,
      },
    );
    assert.equal(
      new URL(url).searchParams.get('X-Amz-Signature'),
      'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
  });
});

describe('createSigner', () => {
  const object = {
    bucket: 'janktm-album',
    key: "2022-06-12 GRADUATION!/Bo's Uplaods/IMG_5974 (1).HEIC",
  };

  it('signs path-style URLs with the key encoded like S3 does', async () => {
    const url = new URL(await createSigner(CONFIG, 100)(object));
    assert.equal(url.origin, CONFIG.endpoint);
    assert.equal(
      url.pathname,
      '/janktm-album/2022-06-12%20GRADUATION%21/Bo%27s%20Uplaods/IMG_5974%20%281%29.HEIC',
    );
    assert.equal(url.searchParams.get('X-Amz-Expires'), '43200');
    // Signed as of the window's start.
    assert.equal(
      url.searchParams.get('X-Amz-Date'),
      new Date(100 * SIGNING_WINDOW_MS)
        .toISOString()
        .replace(/[:-]|\.\d{3}/g, ''),
    );
  });

  it('gives the same URL within a window and a new one in the next', async () => {
    const a = await createSigner(CONFIG, 100)(object);
    const b = await createSigner(CONFIG, 100)(object);
    const c = await createSigner(CONFIG, 101)(object);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('signs a download name into the URL', async () => {
    const url = new URL(
      await createSigner(CONFIG, 100)(object, {
        downloadName: 'IMG_5974 (1).HEIC',
      }),
    );
    assert.equal(
      url.searchParams.get('response-content-disposition'),
      attachmentDisposition('IMG_5974 (1).HEIC'),
    );
    const plain = new URL(await createSigner(CONFIG, 100)(object));
    assert.notEqual(
      url.searchParams.get('X-Amz-Signature'),
      plain.searchParams.get('X-Amz-Signature'),
    );
  });
});

describe('signing windows', () => {
  const now = 1_800_000_000_000;
  const current = currentSigningWindow(now);

  it('accepts the current window and its neighbors', () => {
    assert.ok(isAcceptableSigningWindow(current, now));
    assert.ok(isAcceptableSigningWindow(current - 1, now));
    assert.ok(isAcceptableSigningWindow(current + 1, now));
  });

  it('rejects windows further away, and non-integers', () => {
    assert.ok(!isAcceptableSigningWindow(current - 2, now));
    assert.ok(!isAcceptableSigningWindow(current + 2, now));
    assert.ok(!isAcceptableSigningWindow(current + 0.5, now));
  });
});

describe('encodeKey', () => {
  it('keeps slashes and encodes everything S3 does', () => {
    assert.equal(encodeKey("a b/c!d/e'f*g"), 'a%20b/c%21d/e%27f%2Ag');
    assert.equal(encodeKey('ünï/ok.jpg'), '%C3%BCn%C3%AF/ok.jpg');
  });
});

describe('attachmentDisposition', () => {
  it('has an ASCII fallback and the UTF-8 name', () => {
    assert.equal(
      attachmentDisposition('café "1".jpg'),
      `attachment; filename="caf_ _1_.jpg"; filename*=UTF-8''caf%C3%A9%20%221%22.jpg`,
    );
  });
});

describe('slugify', () => {
  it('makes URL-friendly slugs from folder names', () => {
    assert.equal(slugify('2022-06-12 GRADUATION!'), '2022-06-12-graduation');
    assert.equal(slugify("  Bo's   Café  "), 'bo-s-cafe');
    assert.equal(slugify('!!!'), 'album');
    assert.equal(slugify('a'.repeat(100)).length, 80);
  });

  it('picks the first free suffix', async () => {
    const taken = new Set(['party', 'party-2']);
    assert.equal(
      await uniqueSlug('party', (s) => Promise.resolve(taken.has(s))),
      'party-3',
    );
    assert.equal(
      await uniqueSlug('new', (s) => Promise.resolve(taken.has(s))),
      'new',
    );
  });
});

describe('basename', () => {
  it('is the last path segment', () => {
    assert.equal(basename("Bo's Uplaods/IMG_5974.HEIC"), 'IMG_5974.HEIC');
    assert.equal(basename('IMG_1.JPG'), 'IMG_1.JPG');
  });
});
