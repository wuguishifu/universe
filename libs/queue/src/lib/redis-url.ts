export type ParsedRedisUrl = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  family: 0;
};

const DEFAULT_REDIS_PORT = 6379;

export function resolveRedisConnection(url: string): ParsedRedisUrl {
  const parsedUrl = new URL(url);

  if (parsedUrl.protocol !== 'redis:') {
    throw new Error(`Invalid Redis URL protocol: ${parsedUrl.protocol}`);
  }

  const port =
    parsedUrl.port.length > 0 ? Number(parsedUrl.port) : DEFAULT_REDIS_PORT;

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid Redis URL port: ${parsedUrl.port}`);
  }

  return {
    host: parsedUrl.hostname,
    port,
    username: parsedUrl.username || undefined,
    password: parsedUrl.password || undefined,
    family: 0,
  };
}
