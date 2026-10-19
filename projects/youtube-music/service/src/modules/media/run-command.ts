import { spawn } from 'node:child_process';
import { ProcessError } from '@libs/nest-common';

export type CommandResult = {
  stdout: string;
  /** The last few KB: yt-dlp and ffmpeg both talk a lot on stderr, and put what matters last. */
  stderr: string;
};

const STDERR_TAIL = 8000;

/**
 * Like `runProcess` from nest-common, but resolves with the end of stderr too: ffmpeg reports
 * loudness there.
 */
export function runCommand(
  command: string,
  args: string[],
  { timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
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
      if (signal?.aborted) {
        reject(signal.reason);
      } else if (timedOut) {
        reject(
          new ProcessError(
            `${command} timed out after ${timeoutMs}ms`,
            lastLines(stderr),
          ),
        );
      } else if (code !== 0) {
        reject(
          new ProcessError(
            `${command} exited with code ${code}`,
            errorLines(stderr),
          ),
        );
      } else {
        resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr });
      }
    });
  });
}

const lastLines = (text: string, count = 3) =>
  text.trim().split('\n').slice(-count).join('\n');

/** yt-dlp's `ERROR:` lines say what went wrong; the rest is noise. */
function errorLines(stderr: string): string {
  const errors = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR'));
  return errors.length ? errors.slice(-2).join('\n') : lastLines(stderr);
}
