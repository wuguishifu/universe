// H13 step 2: relative volume of the first 5-minute candle and the day's picks, from the open15
// minute files; writes the full-day download jobs for the top 50 per day.
// Design: research/hypotheses/h13.md. Uses only day d's 09:30–09:34 bars and earlier days.
//
// usage: node --max-old-space-size=16000 research/tools/h13-picks.mjs <cacheDir> [dataDir] [--years 2016,2017]
//   reads <cacheDir>/universe.json; for each requested year (default all) writes
//   <cacheDir>/picks-<YEAR>.json and <cacheDir>/jobs-day-<YEAR>.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const cacheDir = args[0];
const dataDir = args[1] && !args[1].startsWith('--') ? args[1] : 'data';
const yi = args.indexOf('--years');
const YEARS = yi >= 0 ? new Set(args[yi + 1].split(',')) : null;
const W14 = 14;
const MIN_LOOKBACK = 10;
const KEEP = 50;
const MIN_RV = 1;

const U = JSON.parse(readFileSync(`${cacheDir}/universe.json`, 'utf8'));
const { sessions, cand, factorPts } = U;
const NS = sessions.length;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const nyMinute = (t) => {
  const [h, m] = fmt.format(Date.parse(t)).split(':').map(Number);
  return h * 60 + m;
};

const factorAt = (t, i) => {
  const pts = factorPts[t];
  if (!pts) return NaN;
  let f = NaN;
  for (const [k, v] of pts) {
    if (k > i) break;
    f = v;
  }
  return f;
};

// first candle from one open15 file: null = file absent; {empty:true}; or the candle
const memo = new Map();
function candle(t, i) {
  const key = `${t}|${i}`;
  if (memo.has(key)) return memo.get(key);
  const p = `${dataDir}/stocks-open15/${t}/${sessions[i]}.json`;
  let r = null;
  if (existsSync(p)) {
    const bars = JSON.parse(readFileSync(p, 'utf8'));
    let v = 0,
      n = 0,
      o930 = NaN,
      cl = NaN,
      hi = -Infinity,
      lo = Infinity;
    for (const b of bars) {
      const m = nyMinute(b.t);
      if (m < 570 || m > 574) continue;
      if (m === 570) o930 = b.o;
      v += b.v;
      n++;
      cl = b.c; // bars are in time order
      hi = Math.max(hi, b.h);
      lo = Math.min(lo, b.l);
    }
    r = n ? { v, n, o930, cl, hi, lo } : { empty: true };
  }
  memo.set(key, r);
  return r;
}

// gap days: more than half of the day's candidates have an empty file
const inYears = (i) => !YEARS || YEARS.has(sessions[i].slice(0, 4));
const firstI = sessions.findIndex((_, i) => inYears(i));
const status = new Array(NS).fill('none'); // none (not downloaded) | gap | ok
for (let i = Math.max(0, firstI - 40); i < NS; i++) {
  if (i >= firstI && !inYears(i)) continue;
  const c = cand[sessions[i]];
  if (!c.length) continue;
  let have = 0,
    empty = 0;
  for (const [t] of c) {
    const x = candle(t, i);
    if (x) {
      have++;
      if (x.empty) empty++;
    }
  }
  if (have < 0.9 * c.length) continue; // not (fully) downloaded
  status[i] = empty > 0.5 * have ? 'gap' : 'ok';
}

const picks = {};
const stats = {};
for (let i = 0; i < NS; i++) {
  if (status[i] !== 'ok' || !inYears(i)) continue;
  const date = sessions[i];
  // the 14 most recent previous non-gap sessions
  const look = [];
  for (let k = i - 1; k >= 0 && look.length < W14; k--) if (status[k] !== 'gap') look.push(k);
  const st = { cand: 0, noToday: 0, noHist: 0, rvOk: 0, rv1: 0 };
  const rows = [];
  for (const [t, rank, atr, adv, fd, prevC, offOpen] of cand[date]) {
    st.cand++;
    const x = candle(t, i);
    if (!x || x.empty || !(x.v > 0)) {
      st.noToday++;
      continue;
    }
    let s = 0,
      n = 0;
    for (const k of look) {
      const y = candle(t, k);
      if (!y || y.empty) continue;
      const fk = factorAt(t, k);
      s += y.v * (Number.isFinite(fk) ? fk / fd : 1);
      n++;
    }
    if (n < MIN_LOOKBACK || !(s > 0)) {
      st.noHist++;
      continue;
    }
    const rv = x.v / (s / n);
    st.rvOk++;
    if (rv >= MIN_RV) {
      st.rv1++;
      rows.push([t, rank, +rv.toPrecision(5), atr, offOpen, x.o930, x.cl, x.hi, x.lo, x.v]);
    }
  }
  rows.sort((a, b) => b[2] - a[2]);
  picks[date] = rows.slice(0, KEEP);
  stats[date] = st;
}
const gapDays = sessions.filter((_, i) => status[i] === 'gap' && inYears(i));
const fields = ['ticker', 'rank', 'rv', 'atr', 'offOpen', 'o930', 'c934', 'h5', 'l5', 'v5'];

const byYear = {};
for (const [d, rows] of Object.entries(picks)) {
  const y = d.slice(0, 4);
  if (YEARS && !YEARS.has(y)) continue;
  byYear[y] ??= { window: 'day', days: {} };
  byYear[y].days[d] = rows.map((r) => r[0]);
}
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(p * (s.length - 1))] : NaN;
};
console.log(`days ok ${status.filter((s, i) => s === 'ok' && inYears(i)).length}, gap ${gapDays.length} (${gapDays[0] ?? ''} … ${gapDays.at(-1) ?? ''}), not downloaded ${sessions.filter((_, i) => inYears(i) && status[i] === 'none' && cand[sessions[i]].length).length}`);
for (const [y, j] of Object.entries(byYear)) {
  writeFileSync(`${cacheDir}/jobs-day-${y}.json`, JSON.stringify(j));
  const pick = Object.fromEntries(Object.entries(picks).filter(([d]) => d.startsWith(y)));
  const stat = Object.fromEntries(Object.entries(stats).filter(([d]) => d.startsWith(y)));
  writeFileSync(`${cacheDir}/picks-${y}.json`, JSON.stringify({ fields, picks: pick, stats: stat, gapDays: gapDays.filter((d) => d.startsWith(y)) }));
  const ds = Object.keys(j.days);
  const S = ds.map((d) => stats[d]);
  const sd = ds.reduce((a, d) => a + j.days[d].length, 0);
  console.log(
    `${y}: ${ds.length} days; per day median cand ${q(S.map((s) => s.cand), 0.5)}, no file/zero vol today ${q(S.map((s) => s.noToday), 0.5)}, short history ${q(S.map((s) => s.noHist), 0.5)}, RV ok ${q(S.map((s) => s.rvOk), 0.5)}, RV≥1 ${q(S.map((s) => s.rv1), 0.5)} (min ${q(S.map((s) => s.rv1), 0)}); day jobs ${sd} symbol-days`,
  );
}
