// Shared helpers for the part 3 insider study.

/**
 * Cleans the ticker an issuer typed on its filing: drops exchange prefixes and brackets, keeps the
 * first of several classes, and writes share classes Alpaca's way (BRK.B). Undefined if it still
 * doesn't look like a ticker.
 */
export function normalizeSymbol(raw) {
  if (/^\s*(N\/?A|N\.A\.?|NONE|NULL)\s*$/i.test(raw ?? '')) return undefined;
  const first = (raw ?? '')
    .toUpperCase()
    .replace(/\b(NYSE|NASDAQ|NYSEAMERICAN|NYSEMKT|AMEX|OTC|OTCQB|OTCQX|NYSE AMERICAN)\s*:\s*/g, '')
    .replace(/[()]/g, ' ')
    .trim()
    .split(/[\s,;/]+/)[0]
    ?.replace(/-/g, '.');
  return first && /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(first) ? first : undefined;
}

export const readPurchases = (fs, path) =>
  fs.readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
