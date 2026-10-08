import { connect } from 'node:net';

export type Endpoint = { host: string; port: number };

export function isReachable(
  { host, port }: Endpoint,
  {
    timeoutMs,
    refusedIsReachable = false,
  }: {
    timeoutMs: number;
    refusedIsReachable?: boolean;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', (error: NodeJS.ErrnoException) =>
      done(refusedIsReachable && error.code === 'ECONNREFUSED'),
    );
  });
}
