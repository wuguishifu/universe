// H13 step 1: the point-in-time candidate list and the open15 download jobs.
// Design: research/hypotheses/h13.md (pre-registered). Uses only daily bars up to d-1 plus day d's
// official open (to convert split-adjusted ATR into day d's raw terms).
//
// candidate entry: [ticker, dollar-volume rank, ATR14 (day-d raw $), ADV14 (day-d shares), f_d, prev raw close, official open]
// usage: node --max-old-space-size=16000 research/tools/h13-universe.mjs <cacheDir> [dataDir]
//   writes <cacheDir>/universe.json and <cacheDir>/jobs-open15-<YEAR>.json, prints counts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const cacheDir = process.argv[2];
const dataDir = process.argv[3] ?? 'data';
if (!cacheDir) throw new Error('usage: h13-universe.mjs <cacheDir> [dataDir]');
mkdirSync(cacheDir, { recursive: true });

const FIRST_DATE = '2016-01-04';
const LAST_DATE = '2026-11-13';
const TOP = 1000;
const TOP_TIER = 500;
const MIN_HIST = 20;
const DV_WIN = 63;
const W14 = 14;
const MIN_PRICE = 5;
const MIN_ADV = 1_000_000;
const MIN_ATR = 0.5;
const PAD_DAYS = 365;
const DV_FLOOR = 1e6; // entries below $1M median dollar volume can't be in the top 1,000 (checked below)

const sessions = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8'))
  .filter((d) => d.date >= FIRST_DATE && d.date <= LAST_DATE)
  .map((d) => d.date);
const sIdx = new Map(sessions.map((d, i) => [d, i]));
const NS = sessions.length;
const dayMs = 86400_000;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
const barDate = (t) => new Date(Date.parse(t) + 12 * 3600_000).toISOString().slice(0, 10);

// --- ticker ownership windows from the SEC pairs -----------------------------------------------
const NOT_COMMON = /\b(ETF|ETFs|Fund|Funds|Trust|Notes|Warrants?|Units?|Preferred)\b/i;
const pairs = JSON.parse(readFileSync(`${dataDir}/universe/sec-issuer-tickers.json`, 'utf8'));
const alpacaName = new Map();
for (const f of ['assets-inactive.json', 'assets-active.json']) // active last, so it wins
  for (const a of JSON.parse(readFileSync(`${dataDir}/universe/${f}`, 'utf8'))) alpacaName.set(a.symbol, a.name ?? '');

// Ownership and names follow README "Round 3 corrections" (h15's fixes; dated note 1 in h13.md):
// window first .. last + 365 days per (CIK, ticker); the day before a later ticker of the same CIK starts
// trading (bars within 21 sessions of its first filing) ends the earlier one; one ticker per CIK per day
// (most filings wins); a rename whose old ticker has no bars uses the CIK's latest ticker where its bars
// run in one segment (no gap > 10 sessions) from that day to its own first filing.
const byTicker = new Map();
for (const p of pairs) {
  if (!byTicker.has(p.ticker)) byTicker.set(p.ticker, []);
  byTicker.get(p.ticker).push({ ...p });
}
// drop typo pairs
for (const [t, ps] of byTicker) {
  const mx = Math.max(...ps.map((p) => p.filings));
  byTicker.set(
    t,
    ps.filter((p) => !(p.filings < 10 && p.filings < 0.1 * mx)),
  );
}
const kept = [...byTicker.values()].flat();
const inactiveNames = new Map();
for (const a of JSON.parse(readFileSync(`${dataDir}/universe/assets-inactive.json`, 'utf8')))
  (inactiveNames.get(a.symbol) ?? inactiveNames.set(a.symbol, []).get(a.symbol)).push(a.name ?? '');
const activeName = new Map(JSON.parse(readFileSync(`${dataDir}/universe/assets-active.json`, 'utf8')).map((a) => [a.symbol, a.name ?? '']));
const secName = new Map();
const latestLast = new Map();
for (const p of kept) {
  if (p.name) secName.set(p.ticker, p.name);
  if (!latestLast.has(p.ticker) || p.last > latestLast.get(p.ticker)) latestLast.set(p.ticker, p.last);
}
const isCommon = (t) => {
  if (activeName.has(t) && latestLast.get(t) >= '2026-01-01') return !NOT_COMMON.test(activeName.get(t));
  if (secName.get(t)) return !NOT_COMMON.test(secName.get(t));
  if (inactiveNames.has(t)) return !inactiveNames.get(t).some((n) => NOT_COMMON.test(n));
  return true;
};
void alpacaName;

// --- daily bars, cleaned ------------------------------------------------------------------------
let zeroVol = 0,
  badPrints = 0;
function loadAligned(t) {
  const rp = `${dataDir}/daily-raw/${t}.json`;
  const ap = `${dataDir}/daily/${t}.json`;
  if (!existsSync(rp) || !existsSync(ap)) return null;
  const raw = JSON.parse(readFileSync(rp, 'utf8'));
  const adj = JSON.parse(readFileSync(ap, 'utf8'));
  if (!raw.length || !adj.length) return { empty: true };
  const R = new Map(raw.map((b) => [barDate(b.t), b]));
  const A = new Map(adj.map((b) => [barDate(b.t), b]));
  let bars = [];
  for (let i = 0; i < NS; i++) {
    const r = R.get(sessions[i]),
      a = A.get(sessions[i]);
    if (!r || !a || !(a.c > 0) || !(r.c > 0)) continue;
    if (!(r.v > 0)) {
      zeroVol++; // stale print after delisting (README Round 3 correction 4)
      continue;
    }
    bars.push({ i, r, a });
  }
  // bad prints (correction 5): a close more than 50% away from both neighbours, in the same direction, is dropped
  const bad = new Set();
  for (let j = 1; j + 1 < bars.length; j++) {
    const u = Math.log(bars[j].a.c / bars[j - 1].a.c),
      v = Math.log(bars[j + 1].a.c / bars[j].a.c);
    if (Math.abs(u) > Math.log(1.5) && Math.abs(v) > Math.log(1.5) && Math.sign(u) !== Math.sign(v)) bad.add(j);
  }
  if (bad.size) {
    badPrints += bad.size;
    bars = bars.filter((_, j) => !bad.has(j));
  }
  return { bars, lastRaw: barDate(raw.at(-1).t) };
}

// pass 1: which sessions each ticker has a bar on
const tickers = [...byTicker.keys()].filter((t) => byTicker.get(t).length).sort();
const tIdx = new Map(tickers.map((t, k) => [t, k]));
const has = tickers.map(() => null);
let nFiles = 0,
  nEmpty = 0,
  nMissing = 0;
for (const [k, t] of tickers.entries()) {
  const x = loadAligned(t);
  if (!x) {
    nMissing++;
    continue;
  }
  nFiles++;
  if (x.empty || !x.bars.length) {
    nEmpty++;
    continue;
  }
  const h = new Uint8Array(NS);
  for (const b of x.bars) h[b.i] = 1;
  has[k] = h;
}
const firstIdx = (d) => {
  const i = sessions.findIndex((x) => x >= d);
  return i < 0 ? NS : i;
};
const elig = tickers.map(() => new Uint8Array(NS));
let standIn = 0;
{
  const byCik = new Map();
  for (const p of kept) (byCik.get(p.cik) ?? byCik.set(p.cik, []).get(p.cik)).push(p);
  for (const pairsC of byCik.values()) {
    const ps = pairsC.filter((p) => isCommon(p.ticker)).map((p) => ({ ...p, k: tIdx.get(p.ticker), end: addDays(p.last, PAD_DAYS) }));
    for (const p of ps)
      for (const q of ps) {
        if (q === p || q.first <= p.last || !has[q.k]) continue;
        const i0 = firstIdx(q.first);
        let trades = false;
        for (let i = i0; i < Math.min(NS, i0 + 21); i++) if (has[q.k][i]) trades = true;
        if (trades) {
          const c = addDays(q.first, -1);
          if (c < p.end) p.end = c;
        }
      }
    const inPanel = ps.filter((p) => has[p.k]).sort((a, b) => b.filings - a.filings || (a.first < b.first ? 1 : -1));
    if (!inPanel.length) continue;
    const latest = [...inPanel].sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : b.filings - a.filings))[0];
    const lf = firstIdx(latest.first);
    // latest ticker's one-segment start before its own first filing
    let segStart = -1;
    {
      const h = has[latest.k];
      let last = -1;
      for (let i = Math.min(NS - 1, lf); i >= 0; i--)
        if (h[i]) {
          if (last >= 0 && last - i > 10) break;
          last = i;
          segStart = i;
        }
    }
    for (let i = 0; i < NS; i++) {
      const d = sessions[i];
      const w = inPanel.find((x) => x.first <= d && d <= x.end);
      if (w) {
        elig[w.k][i] = 1;
        continue;
      }
      if (!ps.some((x) => !has[x.k] && x.first <= d && d <= x.end)) continue;
      if (i < lf && segStart >= 0 && i >= segStart) {
        elig[latest.k][i] = 1;
        standIn++;
      }
    }
  }
}
let droppedName = tickers.filter((t) => !isCommon(t)).length;
const owned = (t, date) => elig[tIdx.get(t)][sIdx.get(date)] === 1;

// --- per-ticker features (pass 2) ---------------------------------------------------------------
const perSession = Array.from({ length: NS }, () => []); // [tickerIdx, medDV, adv, atr, fd, prevC, offOpen]
const factorPts = {}; // ticker -> [[sessionIdx, f]] change points of raw/adj (close based)
const lastBar = {};
const tmp = new Float64Array(DV_WIN);
for (const [ti, t] of tickers.entries()) {
  if (!has[ti]) continue;
  const x = loadAligned(t);
  lastBar[t] = x.lastRaw;
  const idx = [];
  const rO = [],
    rC = [],
    rV = [],
    aH = [],
    aL = [],
    aC = [],
    aO = [];
  for (const { i, r, a } of x.bars) {
    idx.push(i);
    rO.push(r.o);
    rC.push(r.c);
    rV.push(r.v);
    aO.push(a.o);
    aH.push(a.h);
    aL.push(a.l);
    aC.push(a.c);
  }
  const m = idx.length;
  const fC = rC.map((c, j) => c / aC[j]);
  const pts = [];
  for (let j = 0; j < m; j++) if (!pts.length || Math.abs(fC[j] / pts.at(-1)[1] - 1) > 1e-4) pts.push([idx[j], +fC[j].toPrecision(8)]);
  let any = false;
  for (let j = MIN_HIST; j < m; j++) {
    const i = idx[j];
    const date = sessions[i];
    if (idx[j - 1] < i - 5) continue; // previous bar more than 5 sessions back: stale
    const prevC = rC[j - 1];
    if (!(prevC >= MIN_PRICE)) continue;
    if (!owned(t, date)) continue;
    const w = Math.min(DV_WIN, j);
    for (let k = 0; k < w; k++) tmp[k] = rC[j - 1 - k] * rV[j - 1 - k];
    const arr = tmp.subarray(0, w).sort();
    const med = w % 2 ? arr[(w - 1) / 2] : (arr[w / 2 - 1] + arr[w / 2]) / 2;
    if (med < DV_FLOOR) continue;
    const fd = rO[j] / aO[j];
    if (!(fd > 0) || !Number.isFinite(fd)) continue;
    let sv = 0,
      st = 0;
    for (let k = j - W14; k < j; k++) {
      sv += rV[k] * (fC[k] / fd);
      st += Math.max(aH[k] - aL[k], Math.abs(aH[k] - aC[k - 1]), Math.abs(aL[k] - aC[k - 1]));
    }
    perSession[i].push([ti, med, sv / W14, (st / W14) * fd, fd, prevC, rO[j]]);
    any = true;
  }
  if (any) factorPts[t] = pts;
  if ((ti + 1) % 2000 === 0) console.error(`${ti + 1}/${tickers.length} tickers`);
}

// --- rank and filter -------------------------------------------------------------------------
const cand = {};
let minTopDV = Infinity;
const counts = [];
for (let i = 0; i < NS; i++) {
  const e = perSession[i].sort((a, b) => b[1] - a[1]);
  if (e.length >= TOP) minTopDV = Math.min(minTopDV, e[TOP - 1][1]);
  const top = e.slice(0, TOP);
  const c = [];
  top.forEach((x, r) => {
    if (x[2] >= MIN_ADV && x[3] >= MIN_ATR)
      c.push([tickers[x[0]], r + 1, +x[3].toPrecision(6), Math.round(x[2]), +x[4].toPrecision(8), x[5], x[6]]);
  });
  cand[sessions[i]] = c;
  counts.push({ date: sessions[i], universe: e.length, top: top.length, cand: c.length, tier1: c.filter((x) => x[1] <= TOP_TIER).length });
}
writeFileSync(`${cacheDir}/universe.json`, JSON.stringify({ sessions, cand, factorPts, lastBar }));

// --- open15 jobs: every candidate-day plus its 14 previous sessions ----------------------------
const need = Array.from({ length: NS }, () => new Set());
for (let i = 0; i < NS; i++)
  for (const [t] of cand[sessions[i]]) for (let k = Math.max(0, i - W14); k <= i; k++) need[k].add(t);
const byYear = {};
for (let i = 0; i < NS; i++) {
  const y = sessions[i].slice(0, 4);
  byYear[y] ??= { window: 'open15', days: {} };
  if (need[i].size) byYear[y].days[sessions[i]] = [...need[i]].sort();
}

// --- report ----------------------------------------------------------------------------------
const q = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(p * (s.length - 1))];
};
console.log(`H13 universe (${FIRST_DATE} → ${LAST_DATE}, ${NS} sessions)`);
console.log(`SEC pairs ${pairs.length}, kept ${kept.length}, tickers ${tickers.length}, not common by name ${droppedName}; rename stand-in ticker-days ${standIn}; zero-volume bars dropped ${zeroVol / 2}, bad prints dropped ${badPrints / 2}`);
console.log(`daily files: ${nFiles} present (${nEmpty} empty), ${nMissing} missing`);
console.log(`min $DV of the 1,000th name on any day: ${(minTopDV / 1e6).toFixed(1)}M (floor ${DV_FLOOR / 1e6}M)`);
const act = counts.filter((c) => c.top > 0);
console.log(`sessions with a universe: ${act.length}; first ${act[0]?.date}`);
for (const k of ['universe', 'top', 'cand', 'tier1'])
  console.log(`  ${k.padEnd(8)} per day: min ${q(act.map((c) => c[k]), 0)}  p10 ${q(act.map((c) => c[k]), 0.1)}  median ${q(act.map((c) => c[k]), 0.5)}  p90 ${q(act.map((c) => c[k]), 0.9)}  max ${q(act.map((c) => c[k]), 1)}`);
console.log('per year: median candidates/day, open15 symbol-days, requests (100 symbols each)');
let totReq = 0,
  totSD = 0;
for (const [y, j] of Object.entries(byYear)) {
  writeFileSync(`${cacheDir}/jobs-open15-${y}.json`, JSON.stringify(j));
  const days = Object.values(j.days);
  const sd = days.reduce((a, s) => a + s.length, 0);
  const req = days.reduce((a, s) => a + Math.ceil(s.length / 100), 0);
  totReq += req;
  totSD += sd;
  const yc = counts.filter((c) => c.date.startsWith(y) && c.top > 0).map((c) => c.cand);
  console.log(`  ${y}: ${yc.length ? q(yc, 0.5) : 0} cand/day, ${sd} symbol-days, ${req} requests`);
}
console.log(`total: ${totSD} symbol-days, ${totReq} requests ≈ ${((totReq * 0.4) / 3600).toFixed(1)} h at ~0.4 s each`);
