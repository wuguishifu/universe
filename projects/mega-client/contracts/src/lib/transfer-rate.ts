// No imports, so `nx test mega-client-contracts` can load this with Node's type stripping.

/**
 * Speed is averaged over this long. MEGA's progress comes in bursts and MEGAcmd only prints two
 * decimals of a percent, so a single poll-to-poll difference jumps around too much to show.
 */
export const RATE_WINDOW_MS = 10_000;

/** Fewer samples than this, or spanning less time, and there's no speed to show yet. */
const MIN_SPAN_MS = 1_000;

type Sample = { at: number; bytes: number };

export type RateInput = {
  tag: string;
  /** Bytes done so far. */
  bytes: number;
  /** Only moving transfers have a speed; anything else starts over when it moves again. */
  moving: boolean;
};

/**
 * Speed of each transfer, from how its progress changed across polls. MEGAcmd doesn't report a
 * speed itself.
 */
export class TransferRates {
  private readonly samples = new Map<string, Sample[]>();
  private readonly windowMs: number;

  constructor(windowMs = RATE_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** Adds this poll's progress. Transfers missing from it are forgotten. */
  public record(at: number, transfers: RateInput[]): void {
    const seen = new Set<string>();
    for (const { tag, bytes, moving } of transfers) {
      seen.add(tag);
      if (!moving) {
        this.samples.delete(tag);
        continue;
      }
      const previous = this.samples.get(tag) ?? [];
      const last = previous.at(-1);
      // Went backwards: MEGA restarted it, so the old samples say nothing about now.
      const kept = last && bytes < last.bytes ? [] : previous;
      this.samples.set(
        tag,
        [...kept, { at, bytes }].filter(
          (sample) => sample.at >= at - this.windowMs,
        ),
      );
    }
    for (const tag of this.samples.keys()) {
      if (!seen.has(tag)) this.samples.delete(tag);
    }
  }

  /** Bytes per second over the window, or null if there isn't enough to go on. */
  public bytesPerSecond(tag: string): number | null {
    const samples = this.samples.get(tag);
    const first = samples?.[0];
    const last = samples?.at(-1);
    if (!first || !last || last.at - first.at < MIN_SPAN_MS) return null;
    return ((last.bytes - first.bytes) / (last.at - first.at)) * 1000;
  }
}

/** Seconds left at this speed, or null if it isn't moving. */
export function etaSeconds(
  remainingBytes: number,
  bytesPerSecond: number | null,
): number | null {
  if (!bytesPerSecond || bytesPerSecond <= 0) return null;
  return Math.ceil(Math.max(0, remainingBytes) / bytesPerSecond);
}
