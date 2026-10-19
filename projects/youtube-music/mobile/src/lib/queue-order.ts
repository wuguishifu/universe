/** A shuffled copy (Fisher–Yates). `random` is injectable for tests. */
export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/**
 * The order to play `items` in when starting at `startIndex`: as they are, or the start first and
 * the rest shuffled. At most `limit` long, counting from the start.
 */
export function playOrder<T>(
  items: readonly T[],
  startIndex: number,
  { shuffle, limit }: { shuffle: boolean; limit: number },
  random = Math.random,
): { order: T[]; index: number } {
  const start = items[startIndex];
  if (start === undefined) return { order: [], index: -1 };
  if (shuffle) {
    const rest = items.filter((_, i) => i !== startIndex);
    return {
      order: [start, ...shuffled(rest, random)].slice(0, limit),
      index: 0,
    };
  }
  if (items.length <= limit) return { order: [...items], index: startIndex };
  return { order: items.slice(startIndex, startIndex + limit), index: 0 };
}

/**
 * What comes after `current` when shuffle is turned off: whatever followed it in the original order.
 * Falls back to the original order from the top if it isn't in there.
 */
export function unshuffledUpcoming<T>(
  original: readonly T[],
  current: T | undefined,
  same: (a: T, b: T) => boolean,
): T[] {
  const at =
    current === undefined ? -1 : original.findIndex((t) => same(t, current));
  return at === -1 ? [...original] : original.slice(at + 1);
}
