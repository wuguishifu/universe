import { spawn } from 'child_process';

export class ProcessError extends Error {
  constructor(
    message: string,
    /** Last part of stderr, for logs and error messages. */
    readonly stderrTail: string,
  ) {
    super(stderrTail ? `${message}: ${stderrTail}` : message);
  }
}

/**
 * Runs a command to completion and resolves with stdout; kills it after `timeoutMs`.
 * If `signal` aborts, the process is killed and the promise rejects with `signal.reason`.
 */
export function runProcess(
  command: string,
  args: string[],
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    // Keep only the tail; some CLI tools (ffmpeg, whisper, etc) can be very chatty on stderr.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    child.once('error', (error) => {
      cleanup();
      reject(
        new ProcessError(`Failed to start ${command}: ${error.message}`, ''),
      );
    });
    child.once('close', (code) => {
      cleanup();
      const tail = stderr.trim().split('\n').slice(-5).join('\n');
      if (aborted) {
        reject(signal?.reason);
      } else if (timedOut) {
        reject(
          new ProcessError(`${command} timed out after ${timeoutMs}ms`, tail),
        );
      } else if (code !== 0) {
        reject(new ProcessError(`${command} exited with code ${code}`, tail));
      } else {
        resolve(Buffer.concat(stdout).toString('utf8'));
      }
    });
  });
}
