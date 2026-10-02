import { z } from 'zod';

/**
 * Whether a definition names one key (`perId: false`) or a family of keys, one per id
 * (`perId: true`), stored at `<key>:<id>`.
 */
type RedisKeyBase<P extends boolean> = {
  key: string;
  perId: P;
};

/** A key holding one JSON value. */
export type RedisValueKey<
  S extends z.ZodType = z.ZodType,
  P extends boolean = boolean,
> = RedisKeyBase<P> & { kind: 'value'; schema: S };

/** A Redis hash of string fields to JSON values. */
export type RedisHashKey<
  S extends z.ZodType = z.ZodType,
  P extends boolean = boolean,
> = RedisKeyBase<P> & { kind: 'hash'; schema: S };

/**
 * A Redis set of JSON members. Membership compares the serialized JSON, so stick to primitives:
 * objects with the same fields in a different order are different members.
 */
export type RedisSetKey<
  S extends z.ZodType = z.ZodType,
  P extends boolean = boolean,
> = RedisKeyBase<P> & { kind: 'set'; schema: S };

/** A lock whose value is the holder's token, so only the holder can release it. */
export type RedisLockKey<P extends boolean = boolean> = RedisKeyBase<P> & {
  kind: 'lock';
};

export type RedisKey =
  | RedisValueKey
  | RedisHashKey
  | RedisSetKey
  | RedisLockKey;
export type RedisKeyMap = Record<string, RedisKey>;

/** What a read returns. */
export type RedisOutput<K extends { schema: z.ZodType }> = z.output<
  K['schema']
>;
/** What a write accepts. Reads parse the stored JSON, so writes take the schema's input type. */
export type RedisInput<K extends { schema: z.ZodType }> = z.input<K['schema']>;

/** Per-id keys need an id to address one key; single keys can't take one. */
export type RedisIdArg<K extends RedisKey> = K['perId'] extends true
  ? { id: string }
  : { id?: never };

type RedisKeyOptions<P extends boolean> = { perId?: P };

function perIdOf<P extends boolean>(options?: RedisKeyOptions<P>): P {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (options?.perId ?? false) as P;
}

export function redisValue<
  S extends z.ZodType,
  const P extends boolean = false,
>(name: string, schema: S, options?: RedisKeyOptions<P>): RedisValueKey<S, P> {
  return { kind: 'value', key: name, schema, perId: perIdOf(options) };
}

export function redisHash<S extends z.ZodType, const P extends boolean = false>(
  name: string,
  schema: S,
  options?: RedisKeyOptions<P>,
): RedisHashKey<S, P> {
  return { kind: 'hash', key: name, schema, perId: perIdOf(options) };
}

export function redisSet<S extends z.ZodType, const P extends boolean = false>(
  name: string,
  schema: S,
  options?: RedisKeyOptions<P>,
): RedisSetKey<S, P> {
  return { kind: 'set', key: name, schema, perId: perIdOf(options) };
}

export function redisLock<const P extends boolean = false>(
  name: string,
  options?: RedisKeyOptions<P>,
): RedisLockKey<P> {
  return { kind: 'lock', key: name, perId: perIdOf(options) };
}

/**
 * Puts every key under `<namespace>:` so projects sharing a Redis instance can't collide, and
 * throws if one key could overlap another (a per-id key's ids, or a scan of its family, would
 * reach into the other key).
 */
export function defineRedisKeys<const M extends RedisKeyMap>(
  namespace: string,
  keys: M,
): M {
  const namespaced = Object.fromEntries(
    Object.entries(keys).map(([name, definition]) => [
      name,
      { ...definition, key: `${namespace}:${definition.key}` },
    ]),
  );
  assertNoOverlap(Object.values(namespaced));
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return namespaced as M;
}

function assertNoOverlap(definitions: RedisKey[]) {
  for (const a of definitions) {
    for (const b of definitions) {
      if (a === b) continue;
      if (a.key === b.key || b.key.startsWith(`${a.key}:`)) {
        throw new Error(`Redis key "${b.key}" overlaps "${a.key}"`);
      }
    }
  }
}

/** The concrete Redis key for a definition and, for per-id definitions, an id. */
export function resolveRedisKey(definition: RedisKey, id?: string): string {
  if (!definition.perId) return definition.key;
  if (id === undefined) {
    throw new Error(`Redis key "${definition.key}" needs an id`);
  }
  return `${definition.key}:${id}`;
}
