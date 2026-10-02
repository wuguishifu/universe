import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  type RedisHashKey,
  type RedisIdArg,
  type RedisInput,
  type RedisKey,
  type RedisLockKey,
  type RedisOutput,
  type RedisSetKey,
  type RedisValueKey,
  resolveRedisConnection,
  resolveRedisKey,
} from '@libs/redis-cache';
import {
  REDIS_CACHE_OPTIONS,
  type RedisCacheErrorContext,
  type RedisCacheOptions,
} from './redis-cache';

const SCAN_BATCH_SIZE = 1_000;

const RELEASE_LOCK_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";

type Target<K extends RedisKey> = { key: K } & RedisIdArg<K>;

/**
 * Typed access to Redis through key definitions made with `defineRedisKeys` from
 * `@libs/redis-cache`. Values are stored as JSON and parsed with the definition's schema on read.
 */
@Injectable()
export class RedisCacheService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisCacheService.name);
  private readonly client: Redis;
  private readonly reportError: (context: RedisCacheErrorContext) => void;

  constructor(@Inject(REDIS_CACHE_OPTIONS) options: RedisCacheOptions) {
    this.reportError =
      options.onError ??
      (({ operation, key, error }) =>
        this.logger.error(
          `Redis ${operation} failed${key ? ` for ${key}` : ''}`,
          error,
        ));
    this.client = new Redis(resolveRedisConnection(options.url));
    this.client.on('error', (error) =>
      this.reportError({ operation: 'connection', error }),
    );
  }

  async onApplicationShutdown() {
    await this.client.quit();
  }

  // MARK: values

  async get<K extends RedisValueKey>(
    target: Target<K>,
  ): Promise<RedisOutput<K> | undefined> {
    const key = this.keyOf(target);
    const raw = await this.client.get(key);
    if (raw === null) return undefined;
    return this.parse(target.key, raw, { operation: 'get', key });
  }

  async set<K extends RedisValueKey>(
    target: Target<K> & {
      value: RedisInput<K>;
      /** Omit to keep the value until it's deleted. */
      ttlSeconds?: number;
    },
  ): Promise<void> {
    const key = this.keyOf(target);
    const json = JSON.stringify(target.value);
    if (target.ttlSeconds === undefined) {
      await this.client.set(key, json);
    } else {
      await this.client.set(key, json, 'EX', target.ttlSeconds);
    }
  }

  /** Sets many ids of a per-id value key in one transaction. */
  async mSet<K extends RedisValueKey<z.ZodType, true>>({
    key,
    entries,
    ttlSeconds,
  }: {
    key: K;
    entries: { id: string; value: RedisInput<K> }[];
    ttlSeconds?: number;
  }): Promise<void> {
    if (entries.length === 0) return;
    const transaction = this.client.multi();
    for (const { id, value } of entries) {
      const json = JSON.stringify(value);
      const entryKey = resolveRedisKey(key, id);
      if (ttlSeconds === undefined) {
        transaction.set(entryKey, json);
      } else {
        transaction.set(entryKey, json, 'EX', ttlSeconds);
      }
    }
    await this.exec(transaction);
  }

  /** Every id of a per-id value key. Scans the keyspace, so keep it off hot paths. */
  async getAll<K extends RedisValueKey<z.ZodType, true>>({
    key,
  }: {
    key: K;
  }): Promise<Map<string, RedisOutput<K>>> {
    const prefix = `${key.key}:`;
    const values = new Map<string, RedisOutput<K>>();
    const stream = this.client.scanStream({
      match: `${escapeGlob(prefix)}*`,
      count: SCAN_BATCH_SIZE,
    });

    for await (const batch of stream) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const keys = batch as string[];
      if (keys.length === 0) continue;
      const raws = await this.client.mget(...keys);
      raws.forEach((raw, index) => {
        const entryKey = keys[index];
        if (raw === null || entryKey === undefined) return;
        const value = this.parse(key, raw, {
          operation: 'getAll',
          key: entryKey,
        });
        if (value !== undefined) {
          values.set(entryKey.slice(prefix.length), value);
        }
      });
    }

    return values;
  }

  // MARK: hashes

  async hashGet<K extends RedisHashKey>(
    target: Target<K> & { field: string },
  ): Promise<RedisOutput<K> | undefined> {
    const key = this.keyOf(target);
    const raw = await this.client.hget(key, target.field);
    if (raw === null) return undefined;
    return this.parse(target.key, raw, { operation: 'hashGet', key });
  }

  /** Every field of a hash. Fields that don't match the schema are left out. */
  async hashGetAll<K extends RedisHashKey>(
    target: Target<K>,
  ): Promise<Map<string, RedisOutput<K>>> {
    const key = this.keyOf(target);
    const fields = await this.client.hgetall(key);
    const values = new Map<string, RedisOutput<K>>();
    for (const [field, raw] of Object.entries(fields)) {
      const value = this.parse(target.key, raw, {
        operation: 'hashGetAll',
        key,
      });
      if (value !== undefined) values.set(field, value);
    }
    return values;
  }

  async hashSet<K extends RedisHashKey>(
    target: Target<K> & { field: string; value: RedisInput<K> },
  ): Promise<void> {
    await this.client.hset(
      this.keyOf(target),
      target.field,
      JSON.stringify(target.value),
    );
  }

  async hashDelete<K extends RedisHashKey>(
    target: Target<K> & { field: string },
  ): Promise<void> {
    await this.client.hdel(this.keyOf(target), target.field);
  }

  // MARK: sets

  /** Every member of a set. Members that don't match the schema are left out. */
  async setMembers<K extends RedisSetKey>(
    target: Target<K>,
  ): Promise<RedisOutput<K>[]> {
    const key = this.keyOf(target);
    const raws = await this.client.smembers(key);
    return raws.flatMap((raw) => {
      const value = this.parse(target.key, raw, {
        operation: 'setMembers',
        key,
      });
      return value === undefined ? [] : [value];
    });
  }

  async setHas<K extends RedisSetKey>(
    target: Target<K> & { member: RedisInput<K> },
  ): Promise<boolean> {
    const isMember = await this.client.sismember(
      this.keyOf(target),
      JSON.stringify(target.member),
    );
    return isMember === 1;
  }

  async setAdd<K extends RedisSetKey>(
    target: Target<K> & { members: RedisInput<K>[] },
  ): Promise<void> {
    if (target.members.length === 0) return;
    await this.client.sadd(
      this.keyOf(target),
      ...target.members.map((member) => JSON.stringify(member)),
    );
  }

  async setRemove<K extends RedisSetKey>(
    target: Target<K> & { members: RedisInput<K>[] },
  ): Promise<void> {
    if (target.members.length === 0) return;
    await this.client.srem(
      this.keyOf(target),
      ...target.members.map((member) => JSON.stringify(member)),
    );
  }

  /** Replaces a set's members atomically, so readers never see it empty part-way through. */
  async setReplace<K extends RedisSetKey>(
    target: Target<K> & { members: RedisInput<K>[] },
  ): Promise<void> {
    const key = this.keyOf(target);
    const transaction = this.client.multi().del(key);
    if (target.members.length > 0) {
      transaction.sadd(
        key,
        ...target.members.map((member) => JSON.stringify(member)),
      );
    }
    await this.exec(transaction);
  }

  // MARK: locks

  /** Returns the token to release the lock with, or undefined if someone else holds it. */
  async tryAcquireLock<K extends RedisLockKey>(
    target: Target<K> & { ttlSeconds: number },
  ): Promise<string | undefined> {
    const token = randomUUID();
    const result = await this.client.set(
      this.keyOf(target),
      token,
      'EX',
      target.ttlSeconds,
      'NX',
    );
    return result === 'OK' ? token : undefined;
  }

  /** Releases the lock only if `token` still holds it. Returns whether it did. */
  async releaseLock<K extends RedisLockKey>(
    target: Target<K> & { token: string },
  ): Promise<boolean> {
    const result = await this.client.eval(
      RELEASE_LOCK_SCRIPT,
      1,
      this.keyOf(target),
      target.token,
    );
    return result === 1;
  }

  // MARK: any key

  /** Deletes the key of any kind. Returns whether it existed. */
  async delete<K extends RedisKey>(target: Target<K>): Promise<boolean> {
    return (await this.client.del(this.keyOf(target))) === 1;
  }

  private keyOf(target: { key: RedisKey; id?: string }): string {
    return resolveRedisKey(target.key, target.id);
  }

  private async exec(transaction: ReturnType<Redis['multi']>) {
    const results = await transaction.exec();
    const failure = results?.find(([error]) => error !== null);
    if (failure) throw failure[0];
  }

  private parse<K extends { schema: z.ZodType }>(
    definition: K,
    raw: string,
    context: Omit<RedisCacheErrorContext, 'error'>,
  ): RedisOutput<K> | undefined {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      this.reportError({ ...context, error });
      return undefined;
    }

    const result = definition.schema.safeParse(json);
    if (!result.success) {
      this.reportError({ ...context, error: result.error });
      return undefined;
    }
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return result.data as RedisOutput<K>;
  }
}

/** Escapes Redis glob characters so a key prefix matches only itself in SCAN MATCH. */
function escapeGlob(value: string): string {
  return value.replace(/[*?[\]\\]/g, '\\$&');
}
