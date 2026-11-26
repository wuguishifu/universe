// No imports, so the spec can run this file on Node's type stripping.

/** Lines of ffmpeg's stderr kept for errors and job logs. */
export const STDERR_TAIL_LINES = 20;

export class FfmpegExitError extends Error {
  readonly code: number | null;
  readonly stderrTail: string;

  constructor(code: number | null, signal: string | null, stderrTail: string) {
    super(
      `ffmpeg ${code === null ? `was killed by ${signal ?? 'a signal'}` : `exited with code ${code}`}`,
    );
    this.code = code;
    this.stderrTail = stderrTail;
  }
}

export class FfmpegTimeoutError extends Error {
  readonly stderrTail: string;

  constructor(timeoutMs: number, stderrTail: string) {
    super(`ffmpeg was still running after ${timeoutMs}ms`);
    this.stderrTail = stderrTail;
  }
}

/**
 * ffmpeg failures that can go away on their own, so are worth retrying: VideoToolbox refusing a
 * session when the media engine is busy or the machine is under memory pressure, or a session
 * that breaks mid-encode (-12903 invalid session, e.g. after sleep; -12911 encoder malfunction).
 * Everything else ffmpeg fails at is the args or the input, which a retry won't fix.
 *
 * "cannot create compression session" is also what unsupported settings give, so those are
 * retried too before failing; that only costs the job's attempts.
 */
const TRANSIENT_PATTERNS = [
  /cannot create compression session/i,
  /Error encoding frame: -(12903|12911)\b/,
  /kVTInvalidSessionErr|kVTVideoEncoderMalfunctionErr/,
];

export function isTransientFailure(stderr: string): boolean {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(stderr));
}

/** The last `lines` non-empty lines of `text`. */
export function tail(text: string, lines = STDERR_TAIL_LINES): string {
  return text
    .split(/\r?\n|\r/)
    .filter((line) => line.trim())
    .slice(-lines)
    .join('\n');
}
