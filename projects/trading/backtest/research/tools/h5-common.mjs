// Shared helpers for h5 (weekly put credit spreads). Reads raw JSON bars directly.
import { readFileSync, existsSync } from 'node:fs';

export const DATA = new URL('../../data/', import.meta.url).pathname;
export const MIN = 60_000;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const minuteCache = new Map();
/** Minutes after midnight NY for a UTC ms timestamp (cached per hour). */
export const nyMinute = (ms) => {
  const hourKey = Math.floor(ms / 3_600_000);
  let base = minuteCache.get(hourKey);
  if (base === undefined) {
    const [h] = fmt.format(hourKey * 3_600_000).split(':').map(Number);
    base = h * 60;
    minuteCache.set(hourKey, base);
  }
  return base + Math.floor((ms % 3_600_000) / MIN);
};
export const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));

export const calendar = JSON.parse(readFileSync(`${DATA}calendar.json`, 'utf8'));

/** Calendar days between two YYYY-MM-DD dates. */
export const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Monday (YYYY-MM-DD) of the calendar week containing date. */
export const weekKey = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
};
export const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay(); // Sun=0

/** Trading days grouped by calendar week, in order. */
export const tradingWeeks = (from, to) => {
  const weeks = new Map();
  for (const d of calendar) {
    if (d.date < from || d.date > to) continue;
    const k = weekKey(d.date);
    if (!weeks.has(k)) weeks.set(k, []);
    weeks.get(k).push(d);
  }
  return [...weeks.entries()].map(([monday, days]) => ({ monday, days }));
};

/** Regular-session 1-minute stock bars with NY minute `m` and start time `ms`. */
const stockCache = new Map();
export const stockDay = (ticker, day) => {
  const key = `${ticker}/${day.date}`;
  if (stockCache.has(key)) return stockCache.get(key);
  const path = `${DATA}stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return null;
  const open = hhmm(day.open);
  const close = hhmm(day.close);
  const bars = JSON.parse(readFileSync(path, 'utf8'))
    .map((b) => {
      const ms = Date.parse(b.t);
      return { ...b, ms, m: nyMinute(ms) };
    })
    .filter((b) => b.m >= open && b.m < close)
    .sort((a, b) => a.ms - b.ms);
  if (stockCache.size > 50) stockCache.clear();
  stockCache.set(key, bars);
  return bars;
};
/** Last price known at NY minute `m` (close of the bar starting at m-1 or earlier). */
export const spotAt = (bars, m) => bars.filter((b) => b.m < m).at(-1)?.c;
/** Official close: close of the last regular-session bar. */
export const officialClose = (bars) => bars.at(-1)?.c;

/** Option file for a day: { symbol: bars } with bars carrying ms. Cached for one entry. */
let optCacheKey = null;
let optCache = null;
export const optionDay = (ticker, date) => {
  const key = `${ticker}/${date}`;
  if (optCacheKey === key) return optCache;
  const path = `${DATA}options/${ticker}/${date}.json`;
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const out = new Map();
  for (const [sym, bars] of Object.entries(raw)) {
    out.set(
      sym,
      bars.map((b) => ({ ...b, ms: Date.parse(b.t) })).sort((a, b) => a.ms - b.ms),
    );
  }
  optCacheKey = key;
  optCache = out;
  return out;
};

export const occ = (ticker, expiry, type, strike) =>
  `${ticker}${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${type}${String(
    Math.round(strike * 1000),
  ).padStart(8, '0')}`;

/** Expirations (YYYY-MM-DD) present in an option file. */
export const expirations = (chain, ticker) => {
  const set = new Set();
  for (const sym of chain.keys()) {
    const e = sym.slice(ticker.length, ticker.length + 6);
    set.add(`20${e.slice(0, 2)}-${e.slice(2, 4)}-${e.slice(4, 6)}`);
  }
  return [...set].sort();
};

/** Strikes present for an expiry/type. */
export const strikes = (chain, ticker, expiry, type) => {
  const prefix = occ(ticker, expiry, type, 0).slice(0, -8);
  const out = [];
  for (const sym of chain.keys()) {
    if (sym.startsWith(prefix)) out.push(Number(sym.slice(-8)) / 1000);
  }
  return out.sort((a, b) => a - b);
};

/** Open of the first bar starting in [t, t + 5 min]; the fill print for an order sent at t. */
export const firstPrint = (bars, t, maxWait = 5 * MIN) => {
  if (!bars) return undefined;
  for (const b of bars) {
    if (b.ms >= t && b.ms <= t + maxWait) return { price: b.o, ms: b.ms };
    if (b.ms > t + maxWait) break;
  }
  return undefined;
};

/** UTC ms of NY minute m on the day, using a stock bar as the anchor. */
export const msAt = (bars, m) => bars[0].ms + (m - bars[0].m) * MIN;

/**
 * Settlement price for a day. 'c1559' = close of the last regular-session bar (the original h5
 * choice); 'o1600' = open of the bar starting at the close minute; 'c1600' = that bar's close
 * (README's literal wording; it includes after-hours prints). Falls back to c1559 if missing.
 */
const settleCache = new Map();
export const settlement = (ticker, day, mode = 'c1559') => {
  const bars = stockDay(ticker, day);
  if (mode === 'c1559') return officialClose(bars);
  const key = `${ticker}/${day.date}`;
  let bar = settleCache.get(key);
  if (bar === undefined) {
    const close = hhmm(day.close);
    bar = JSON.parse(readFileSync(`${DATA}stocks/${ticker}/${day.date}.json`, 'utf8')).find(
      (b) => nyMinute(Date.parse(b.t)) === close,
    ) ?? null;
    settleCache.set(key, bar);
  }
  if (!bar) return officialClose(bars);
  return mode === 'o1600' ? bar.o : bar.c;
};
