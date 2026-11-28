// No imports, so its spec can run this file on Node's type stripping.

/** "2022-06-12 GRADUATION!" → "2022-06-12-graduation". Never empty. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Combining marks, so "café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || 'album';
}

/** `base`, else `base-2`, `base-3`, …: the first that `isTaken` says is free. */
export async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; ; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await isTaken(slug))) return slug;
  }
}

/** The file name at the end of an item's path. */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
