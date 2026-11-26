// No imports, so the spec can run this file on Node's type stripping.

/** Longest unterminated line kept, in case a step writes media to stdout. */
const MAX_PENDING_CHARS = 1000;

/**
 * Parses ffmpeg's `-progress pipe:1` output (`key=value` lines, a block every ~0.5s) and calls
 * `onOutTime` with how far into the output ffmpeg is, in ms.
 */
export function createProgressParser(
  onOutTime: (outTimeMs: number) => void,
): (chunk: string) => void {
  let pending = '';
  return (chunk) => {
    const lines = (pending + chunk).split('\n');
    pending = (lines.pop() ?? '').slice(-MAX_PENDING_CHARS);
    for (const line of lines) {
      const [key, value] = line.trim().split('=', 2);
      // `out_time_ms` is also in microseconds (an old ffmpeg bug), so only `out_time_us` is used.
      if (key === 'out_time_us' && value && /^\d+$/.test(value)) {
        onOutTime(Number(value) / 1000);
      }
    }
  };
}

/** Downloading takes 0-5%, the steps share 5-95% evenly, and probing and uploading take 95-100%. */
const DOWNLOAD_END = 5;
const STEPS_END = 95;

/** A step's fraction never reaches 1 before it exits: its expected duration is only a guess. */
const MAX_STEP_FRACTION = 0.99;

/**
 * Turns a job's phases into one 0-100 number, for `job.updateProgress` (Bull Board draws it as a
 * bar). Reports at most once per `intervalMs`, except at phase changes and the end.
 */
export class ProgressTracker {
  private lastReportedAt = -Infinity;
  private lastPercent = -1;
  private readonly steps: number;
  private readonly report: (percent: number) => void;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    steps: number,
    report: (percent: number) => void,
    intervalMs = 1000,
    now: () => number = Date.now,
  ) {
    this.steps = steps;
    this.report = report;
    this.intervalMs = intervalMs;
    this.now = now;
  }

  download(fraction: number) {
    this.update(DOWNLOAD_END * clamp(fraction), fraction === 0);
  }

  /** `fraction` is how far into step `index` (0-based) ffmpeg is. */
  step(index: number, fraction: number) {
    const span = (STEPS_END - DOWNLOAD_END) / this.steps;
    this.update(
      DOWNLOAD_END +
        span * (index + Math.min(clamp(fraction), MAX_STEP_FRACTION)),
      fraction === 0,
    );
  }

  upload(fraction: number) {
    this.update(
      STEPS_END + (100 - STEPS_END) * clamp(fraction),
      fraction === 0,
    );
  }

  done() {
    this.update(100, true);
  }

  private update(value: number, force: boolean) {
    const percent = Math.floor(value);
    if (percent === this.lastPercent) return;
    const now = this.now();
    if (
      !force &&
      percent !== 100 &&
      now - this.lastReportedAt < this.intervalMs
    )
      return;
    this.lastReportedAt = now;
    this.lastPercent = percent;
    this.report(percent);
  }
}

/** How far into a step its output is, from the duration it's expected to reach. */
export function stepFraction(
  outTimeMs: number,
  expectedMs: number | undefined,
): number {
  return expectedMs && expectedMs > 0 ? outTimeMs / expectedMs : 0;
}

function clamp(fraction: number): number {
  return Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
}
