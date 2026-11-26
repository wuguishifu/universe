import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import { decryptToken, encryptToken, tokenAad } from './token-cipher.ts';

const key = randomBytes(32);
const token = 'access-sandbox-4da9b145-be2d-4adf-a759-675bd05948f5';
const aad = tokenAad('user1', 'item1');

describe('token cipher', () => {
  it('round-trips', () => {
    assert.equal(decryptToken(key, encryptToken(key, token, aad), aad), token);
  });

  it('uses a new IV every time', () => {
    assert.notEqual(
      encryptToken(key, token, aad),
      encryptToken(key, token, aad),
    );
  });

  it('fails for another user or item', () => {
    const payload = encryptToken(key, token, aad);
    assert.throws(() => decryptToken(key, payload, tokenAad('user2', 'item1')));
    assert.throws(() => decryptToken(key, payload, tokenAad('user1', 'item2')));
  });

  it('fails with another key', () => {
    const payload = encryptToken(key, token, aad);
    assert.throws(() => decryptToken(randomBytes(32), payload, aad));
  });

  it('fails when the ciphertext is changed', () => {
    const [version, iv, tag, ciphertext] = encryptToken(key, token, aad).split(
      ':',
    );
    const flipped = Buffer.from(ciphertext, 'base64url');
    flipped[0] ^= 1;
    const payload = [version, iv, tag, flipped.toString('base64url')].join(':');
    assert.throws(() => decryptToken(key, payload, aad));
  });

  it('rejects other formats', () => {
    assert.throws(() => decryptToken(key, token, aad), /Unrecognized/);
    assert.throws(
      () =>
        decryptToken(key, `v2${encryptToken(key, token, aad).slice(2)}`, aad),
      /Unrecognized/,
    );
  });
});
