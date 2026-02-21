export function getOrCreateList<T, K extends string>(map: Map<K, T[]>, key: K): T[] {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created: T[] = [];
  map.set(key, created);
  return created;
}
