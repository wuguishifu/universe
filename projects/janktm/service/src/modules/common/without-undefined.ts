/** A copy of `value` without its undefined fields, which Convex arguments can't have. */
export function withoutUndefined<T extends object>(value: T): T {
  const copy = { ...value };
  for (const key in copy) {
    if (copy[key] === undefined) delete copy[key];
  }
  return copy;
}
