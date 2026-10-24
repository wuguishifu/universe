// Run with `nx test mega-client-web` (Node's built-in test runner; Node strips the types).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatBytes, formatEta, formatSpeed } from './format.ts';

describe('formatBytes', () => {
  for (const [bytes, text] of [
    [0, '0 B'],
    [900, '900 B'],
    [1536, '1.50 KB'],
    [12.5 * 1024 ** 2, '12.5 MB'],
    [4.75 * 1024 ** 3, '4.75 GB'],
    [300 * 1024 ** 3, '300 GB'],
    [2 * 1024 ** 5, '2048 TB'],
  ] as const) {
    it(`${bytes} ─► ${text}`, () => assert.equal(formatBytes(bytes), text));
  }
});

describe('formatSpeed', () => {
  it('adds /s', () => assert.equal(formatSpeed(3 * 1024 ** 2), '3.00 MB/s'));
});

describe('formatEta', () => {
  for (const [seconds, text] of [
    [0, '0s'],
    [45.4, '45s'],
    [725, '12m 5s'],
    [3 * 3600 + 20 * 60, '3h 20m'],
    [50 * 3600, '2d 2h'],
  ] as const) {
    it(`${seconds} ─► ${text}`, () => assert.equal(formatEta(seconds), text));
  }
});
