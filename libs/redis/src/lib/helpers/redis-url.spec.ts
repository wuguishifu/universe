import { describe, expect, it } from 'vitest';

import { parseRedisUrl, resolveRedisConnection } from './redis-url.js';

describe('parseRedisUrl', () => {
  it('parses Redis URLs with dual-stack DNS enabled', () => {
    expect(
      parseRedisUrl('redis://default:secret@redis.railway.internal')
    ).toEqual({
      host: 'redis.railway.internal',
      port: 6379,
      username: 'default',
      password: 'secret',
      family: 0,
    });
  });
});

describe('resolveRedisConnection', () => {
  it('uses the private URL in release environments', () => {
    expect(
      resolveRedisConnection({
        nodeEnv: 'release',
        publicUrl: 'redis://default:secret@public.example.com:1234',
        privateUrl: 'redis://default:secret@redis.railway.internal:6379',
      })
    ).toMatchObject({
      host: 'redis.railway.internal',
      family: 0,
    });
  });
});
