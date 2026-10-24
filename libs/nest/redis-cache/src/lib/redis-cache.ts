export type RedisCacheErrorContext = {
  /** The service method that hit the error, or `connection` for client errors. */
  operation: string;
  /** The Redis key involved, when there is one. */
  key?: string;
  error: unknown;
};

export type RedisCacheOptions = {
  /** A `redis://` URL. */
  url: string;
  /**
   * Called for errors the service doesn't throw: a stored value that no longer matches its schema
   * (the read then treats it as missing) and client connection errors. Command failures still
   * throw to the caller. Defaults to logging.
   */
  onError?: (context: RedisCacheErrorContext) => void;
};

export const REDIS_CACHE_OPTIONS = 'REDIS_CACHE_OPTIONS';
