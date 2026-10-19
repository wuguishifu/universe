/** Roughly what streaming services normalize to. */
export const TARGET_LUFS = -14;

/**
 * Player volume (0–1) that brings a track to `TARGET_LUFS`. The player can't amplify, so tracks
 * quieter than the target stay at full volume and only louder ones are turned down.
 */
export function normalizedVolume(
  loudnessLufs: number | null | undefined,
  target = TARGET_LUFS,
): number {
  if (loudnessLufs == null || !Number.isFinite(loudnessLufs)) return 1;
  const gainDb = target - loudnessLufs;
  return Math.min(1, Math.max(0.05, 10 ** (gainDb / 20)));
}
