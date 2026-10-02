// Run with `nx test redis-cache` (Node's built-in test runner; Node strips the types).
import { z } from 'zod';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defineRedisKeys,
  redisHash,
  redisLock,
  redisSet,
  redisValue,
  resolveRedisKey,
} from './redis-keys.ts';

describe('defineRedisKeys', () => {
  it('namespaces every key', () => {
    const keys = defineRedisKeys('app', {
      flag: redisValue('flag', z.boolean()),
      sessions: redisHash('sessions', z.string(), { perId: true }),
    });
    assert.equal(keys.flag.key, 'app:flag');
    assert.equal(keys.sessions.key, 'app:sessions');
    assert.equal(keys.sessions.perId, true);
  });

  it('rejects duplicate keys', () => {
    assert.throws(() =>
      defineRedisKeys('app', {
        a: redisSet('members', z.string()),
        b: redisLock('members'),
      }),
    );
  });

  it('rejects a key nested under another', () => {
    assert.throws(() =>
      defineRedisKeys('app', {
        settings: redisValue('settings', z.string(), { perId: true }),
        defaults: redisValue('settings:defaults', z.string()),
      }),
    );
  });

  it('allows keys that only share a leading string', () => {
    assert.doesNotThrow(() =>
      defineRedisKeys('app', {
        settings: redisValue('settings', z.string(), { perId: true }),
        settingsLock: redisLock('settings-lock'),
      }),
    );
  });
});

describe('resolveRedisKey', () => {
  it('appends the id to per-id keys', () => {
    const settings = redisValue('settings', z.string(), { perId: true });
    assert.equal(resolveRedisKey(settings, '42'), 'settings:42');
    assert.throws(() => resolveRedisKey(settings));
  });

  it('uses single keys as they are', () => {
    assert.equal(resolveRedisKey(redisLock('lock')), 'lock');
  });
});
