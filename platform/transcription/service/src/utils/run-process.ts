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

/** Runs a command to completion and resolves with stdout; kills it after `timeoutMs`. */
export function runProcess(
  command: string,
  args: string[],
  { timeoutMs }: { timeoutMs: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    // Keep only the tail; whisper and ffmpeg can be very chatty on stderr.
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(
        new ProcessError(`Failed to start ${command}: ${error.message}`, ''),
      );
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const tail = stderr.trim().split('\n').slice(-5).join('\n');
      if (timedOut) {
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
