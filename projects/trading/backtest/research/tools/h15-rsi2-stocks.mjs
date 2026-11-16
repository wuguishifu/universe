// H15: Connors RSI(2) reversal on liquid single stocks, as pre-registered in research/hypotheses/h15.md.
// usage: node research/tools/h15-rsi2-stocks.mjs [--check] [--cache=<file>] [--boot=2000] [data dir]
//   --check   reproduce h8's SPY same-close result and print the data checks; no strategy number
//   --cache   v8-serialized panel (prices + dollar-volume medians) to skip re-reading ~20k JSON files
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deserialize, serialize } from 'node:v8';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const CACHE = opt('cache', null);
const BOOT = Number(opt('boot', 2000));
const dataDir = args.find((a) => !a.startsWith('--')) ?? 'data';

const FIRST_ENTRY = '2017-01-03';
const END = '2026-11-13';
const NAME_RX = /\b(ETF|Fund|Trust|Notes|Warrants?|Units?|Preferred)\b/i;
const SEG_GAP = 10; // trading days between bars that split a ticker into segments
const COSTS = { A: { zero: 0, primary: 0.0002, stress: 0.0005 }, B: { zero: 0, primary: 0.0005, stress: 0.0015 } };
const NW_LAG = 10;

// --- helpers ------------------------------------------------------------------------------------
const mean = (xs) => {
  let s = 0;
  for (const x of xs) s += x;
  return s / (xs.length || 1);
};
const sdev = (xs) => {
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / Math.max(1, xs.length - 1));
};
const tstat = (xs) => (mean(xs) / sdev(xs)) * Math.sqrt(xs.length);
const compound = (rs) => rs.reduce((p, r) => p * (1 + r), 1);
const cagr = (rs) => compound(rs) ** (252 / rs.length) - 1;
const maxDD = (rs) => {
  let eq = 1;
  let peak = 1;
  let dd = 0;
  for (const r of rs) {
    eq *= 1 + r;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
  }
  return dd;
};
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const bp = (x, d = 1) => (Number.isFinite(x) ? `${(x * 1e4).toFixed(d)}` : 'n/a');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const addDays = (d, n) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

// --- calendar -----------------------------------------------------------------------------------
const readBars = (path) => {
  if (!existsSync(path)) return [];
  const txt = readFileSync(path, 'utf8');
  return txt.length < 3 ? [] : JSON.parse(txt);
};
const bilBars = readBars(`${dataDir}/daily/BIL.json`);
const dates = bilBars.map((b) => b.t.slice(0, 10)).filter((d) => d <= END);
const D = dates.length;
const idx = new Map(dates.map((d, i) => [d, i]));
const START = idx.get(FIRST_ENTRY);
const LAST = D - 1;
if (START === undefined || dates[LAST] !== END) throw new Error('window dates');
const bilC = dates.map((_, i) => bilBars[i].c);
const bilRet = bilC.map((c, i) => (i === 0 ? 0 : c / bilC[i - 1] - 1));

let zeroVol = 0;
/** Adjusted close (and raw close/volume if given) on the global calendar; NaN where no bar. */
function onCalendar(adj, raw) {
  const C = new Float64Array(D).fill(NaN);
  for (const b of adj) {
    const i = idx.get(b.t.slice(0, 10));
    if (i !== undefined) C[i] = b.c;
  }
  if (!raw) return { C };
  const RC = new Float32Array(D).fill(NaN);
  const DV = new Float64Array(D).fill(NaN);
  for (const b of raw) {
    const i = idx.get(b.t.slice(0, 10));
    // zero-volume bars are stale prints (e.g. EV after its 2021-03-01 acquisition): treated as no bar (dated note 1)
    if (i !== undefined && b.v > 0) {
      RC[i] = b.c;
      DV[i] = b.c * b.v;
    } else if (i !== undefined) zeroVol++;
  }
  // a day counts as a bar only if both series have it
  for (let i = 0; i < D; i++) if (!Number.isFinite(C[i]) || !Number.isFinite(RC[i])) C[i] = RC[i] = DV[i] = NaN;
  return { C, RC, DV };
}

// --- universe metadata --------------------------------------------------------------------------
const sec = JSON.parse(readFileSync(`${dataDir}/universe/sec-issuer-tickers.json`, 'utf8'));
const alpacaName = new Map();
const inactiveNames = new Map();
for (const a of JSON.parse(readFileSync(`${dataDir}/universe/assets-active.json`, 'utf8'))) alpacaName.set(a.symbol, a.name ?? '');
for (const a of JSON.parse(readFileSync(`${dataDir}/universe/assets-inactive.json`, 'utf8')))
  (inactiveNames.get(a.symbol) ?? inactiveNames.set(a.symbol, []).get(a.symbol)).push(a.name ?? '');
const secName = new Map();
for (const p of sec) if (p.name) secName.set(p.ticker, p.name);
const latestLast = new Map();
for (const p of sec) if (!latestLast.has(p.ticker) || p.last > latestLast.get(p.ticker)) latestLast.set(p.ticker, p.last);
/**
 * Common-stock name test (dated note 1 in h15.md): Alpaca's active name is today's security on the symbol,
 * so it is trusted only if the SEC company still files under the ticker in 2026; otherwise the SEC name,
 * then Alpaca's inactive names; a ticker with no usable name is kept.
 */
function isCommon(t) {
  if (alpacaName.has(t) && latestLast.get(t) >= '2026-01-01') return !NAME_RX.test(alpacaName.get(t));
  if (secName.get(t)) return !NAME_RX.test(secName.get(t));
  if (inactiveNames.has(t)) return !inactiveNames.get(t).some((n) => NAME_RX.test(n));
  return true;
}
/** README's literal rule: Alpaca name (active, else inactive), else SEC name. */
function isCommonReadme(t) {
  if (alpacaName.has(t)) return !NAME_RX.test(alpacaName.get(t));
  if (inactiveNames.has(t)) return !inactiveNames.get(t).some((n) => NAME_RX.test(n));
  return !NAME_RX.test(secName.get(t) ?? '');
}
const secTickers = [...new Set(sec.map((p) => p.ticker))].sort();
const tickers = secTickers; // the name filter is applied in eligibility()
const nameDropped = secTickers.filter((t) => !isCommon(t)).length;
const nameDroppedReadme = secTickers.filter((t) => !isCommonReadme(t)).length;

// --- panel: prices and 63-day median dollar volume ----------------------------------------------
function buildPanel() {
  const out = [];
  let noBars = 0;
  for (const t of tickers) {
    const adj = readBars(`${dataDir}/daily/${t}.json`);
    const raw = readBars(`${dataDir}/daily-raw/${t}.json`);
    if (!adj.length || !raw.length) {
      noBars++;
      continue;
    }
    const { C, RC, DV } = onCalendar(adj, raw);
    // dvMed[t]: median raw $ volume over t-63..t-1, if >= 60 bars there and a bar at t-1 with raw close >= $5
    const dvMed = new Float32Array(D).fill(NaN);
    const win = [];
    for (let i = Math.max(64, START - 1); i < D; i++) {
      if (!Number.isFinite(RC[i - 1]) || RC[i - 1] < 5) continue;
      win.length = 0;
      for (let j = i - 63; j < i; j++) if (Number.isFinite(DV[j])) win.push(DV[j]);
      if (win.length < 60) continue;
      win.sort((a, b) => a - b);
      const m = win.length >> 1;
      dvMed[i] = win.length % 2 ? win[m] : (win[m - 1] + win[m]) / 2;
    }
    out.push({ t, C, RC, dvMed });
  }
  return { panel: out, noBars, zeroVol };
}

let built;
if (CACHE && existsSync(CACHE)) built = deserialize(readFileSync(CACHE));
else {
  built = buildPanel();
  if (CACHE) writeFileSync(CACHE, serialize(built));
}
const { panel, noBars } = built;
zeroVol = built.zeroVol;
const K = panel.length;
const kOf = new Map(panel.map((p, k) => [p.t, k]));

// --- eligibility (company identity, one ticker per CIK per day) ---------------------------------
/**
 * Returns Uint8Array per panel ticker: 1 if the ticker represents some CIK on that day (h15.md, universe 1-2
 * and dated note 1). mode 'main': window first .. last+365, cut the day before a later ticker of the same CIK
 * starts trading; if the active ticker has no bars, the CIK's latest ticker stands in when its bars run
 * continuously from that day to its own first filing (a rename whose history Alpaca keeps under the new symbol).
 * mode 'readme': window first .. last, no stand-in, README name rule.
 */
function eligibility(mode) {
  const main = mode === 'main';
  const common = main ? isCommon : isCommonReadme;
  const byCik = new Map();
  for (const p of sec) (byCik.get(p.cik) ?? byCik.set(p.cik, []).get(p.cik)).push(p);
  const el = panel.map(() => new Uint8Array(D));
  const stCache = new Map();
  const stOf = (k) => stCache.get(k) ?? stCache.set(k, structure(panel[k].C)).get(k);
  const firstIdx = (d) => {
    let i = idx.get(d);
    if (i !== undefined) return i;
    i = dates.findIndex((x) => x >= d);
    return i < 0 ? D : i;
  };
  let standIn = 0;
  for (const pairs of byCik.values()) {
    const ps = pairs
      .filter((p) => common(p.ticker))
      .map((p) => ({ ...p, k: kOf.get(p.ticker), end: main ? addDays(p.last, 365) : p.last }));
    if (main)
      for (const p of ps)
        for (const q of ps) {
          if (q === p || q.first <= p.last || q.k === undefined) continue;
          const i0 = firstIdx(q.first);
          const C = panel[q.k].C;
          let trades = false;
          for (let i = i0; i < Math.min(D, i0 + 21); i++) if (Number.isFinite(C[i])) trades = true;
          if (trades) {
            const cut = addDays(q.first, -1);
            if (cut < p.end) p.end = cut;
          }
        }
    const inPanel = ps.filter((p) => p.k !== undefined);
    if (!inPanel.length) continue;
    const order = (a, b) => b.filings - a.filings || (a.first < b.first ? 1 : a.first > b.first ? -1 : 0);
    inPanel.sort(order);
    const latest = [...inPanel].sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : b.filings - a.filings))[0];
    let latestSeg = null;
    for (let i = START - 1; i < D; i++) {
      const d = dates[i];
      const w = inPanel.find((x) => x.first <= d && d <= x.end);
      if (w) {
        el[w.k][i] = 1;
        continue;
      }
      if (!main || !ps.some((x) => x.k === undefined && x.first <= d && d <= x.end)) continue;
      // stand-in: the CIK's latest ticker, if its bars are one segment from here to its own first filing
      const st = stOf(latest.k);
      if (latestSeg === null) {
        const j = st.prevBar[Math.min(D - 1, firstIdx(latest.first))];
        latestSeg = j >= 0 ? st.segStart[j] : -2;
      }
      const pb = st.prevBar[i];
      if (pb >= 0 && i < firstIdx(latest.first) && st.segStart[pb] === latestSeg) {
        el[latest.k][i] = 1;
        standIn++;
      }
    }
  }
  el.standIn = standIn;
  return el;
}

/** rank[k][i] = 1..1000 by dvMed among eligible tickers on day i, 0 otherwise; plus eligible counts. */
function ranks(el) {
  const rank = panel.map(() => new Int16Array(D));
  const nElig = new Int32Array(D);
  const buf = [];
  for (let i = START - 1; i < D; i++) {
    buf.length = 0;
    for (let k = 0; k < K; k++) if (el[k][i] && Number.isFinite(panel[k].dvMed[i])) buf.push(k);
    nElig[i] = buf.length;
    buf.sort((a, b) => panel[b].dvMed[i] - panel[a].dvMed[i] || (panel[a].t < panel[b].t ? -1 : 1));
    for (let r = 0; r < Math.min(1000, buf.length); r++) rank[buf[r]][i] = r + 1;
  }
  return { rank, nElig };
}

// --- per-ticker bar structure and indicators ----------------------------------------------------
function structure(C) {
  const segEnd = new Int32Array(D).fill(-1);
  const segStart = new Int32Array(D).fill(-1);
  const prevBar = new Int32Array(D).fill(-1);
  let last = -1;
  let s0 = -1;
  const bars = [];
  for (let i = 0; i < D; i++) {
    if (Number.isFinite(C[i])) {
      if (last < 0 || i - last > SEG_GAP) s0 = i;
      segStart[i] = s0;
      bars.push(i);
      last = i;
    }
    prevBar[i] = last;
  }
  for (let j = bars.length - 1, e = -1; j >= 0; j--) {
    const i = bars[j];
    if (j === bars.length - 1 || bars[j + 1] - i > SEG_GAP) e = i;
    segEnd[i] = e;
  }
  return { segEnd, segStart, prevBar, bars };
}

/** Wilder RSI(2) and close vs SMA200 / SMA5 on a price series P over the given bars, segment by segment. */
function indicators(P, st, kind = 'wilder') {
  const rsi = new Float32Array(D).fill(NaN);
  const f200 = new Uint8Array(D).fill(2); // 1 above, 0 not above, 2 undefined
  const a5 = new Uint8Array(D).fill(2);
  const rs = (u, d) => (u + d === 0 ? 50 : d === 0 ? 100 : 100 - 100 / (1 + u / d));
  let seg = [];
  const flush = () => {
    if (!seg.length) return;
    let aU = NaN;
    let aD = NaN;
    let sum200 = 0;
    let sum5 = 0;
    for (let j = 0; j < seg.length; j++) {
      const i = seg[j];
      const x = P[i];
      sum200 += x;
      sum5 += x;
      if (j >= 200) sum200 -= P[seg[j - 200]];
      if (j >= 5) sum5 -= P[seg[j - 5]];
      if (j >= 199) f200[i] = x > sum200 / 200 ? 1 : 0;
      if (j >= 4) a5[i] = x > sum5 / 5 ? 1 : 0;
      if (j >= 1) {
        const ch = x - P[seg[j - 1]];
        const U = Math.max(ch, 0);
        const Dn = Math.max(-ch, 0);
        if (kind === 'cutler') {
          if (j >= 2) {
            const c1 = P[seg[j - 1]] - P[seg[j - 2]];
            rsi[i] = rs((U + Math.max(c1, 0)) / 2, (Dn + Math.max(-c1, 0)) / 2);
          }
        } else if (j === 2) {
          const c1 = P[seg[1]] - P[seg[0]];
          aU = (Math.max(c1, 0) + U) / 2;
          aD = (Math.max(-c1, 0) + Dn) / 2;
        } else if (j > 2) {
          aU = (aU + U) / 2;
          aD = (aD + Dn) / 2;
          rsi[i] = rs(aU, aD);
        }
      }
    }
    seg = [];
  };
  for (const i of st.bars) {
    if (seg.length && st.segStart[i] !== st.segStart[seg[0]]) flush();
    seg.push(i);
  }
  flush();
  return { rsi, f200, a5 };
}

// SPY
const spy = onCalendar(readBars(`${dataDir}/daily/SPY.json`)).C;
for (let i = 0; i < D; i++) if (!Number.isFinite(spy[i])) throw new Error(`SPY missing ${dates[i]}`);
const spySt = structure(spy);
const spyInd = indicators(spy, spySt);

/** Residual price: cumulated stock return minus SPY's over the same bar-to-bar span. */
function residual(C, st) {
  const Z = new Float64Array(D).fill(NaN);
  let prev = -1;
  for (const i of st.bars) {
    if (prev < 0 || st.segStart[i] !== st.segStart[prev]) Z[i] = 100;
    else Z[i] = Z[prev] * (1 + C[i] / C[prev] - 1 - (spy[i] / spy[prev] - 1));
    prev = i;
  }
  return Z;
}

// --- check mode: h8 reproduction and data checks ------------------------------------------------
function h8SpyRepro() {
  // h8 SC: runs from START with indicators from 2016-01-04; adjusted closes; exit C > SMA5; 1 bp
  const trades = [];
  let pos = null;
  for (let i = START; i <= LAST; i++) {
    if (pos !== null) {
      if (i > pos && (spyInd.a5[i] === 1 || i === LAST)) {
        trades.push(spy[i] / spy[pos] - 1);
        pos = null;
      }
      continue;
    }
    if (spyInd.rsi[i] < 10 && spyInd.f200[i] === 1 && i < LAST) pos = i;
  }
  return trades;
}

if (CHECK) {
  const tr = h8SpyRepro();
  console.log(`h8 reproduction (SPY, same close): ${tr.length} trades, mean gross ${pct(mean(tr), 3)}, net at 1 bp ${pct(mean(tr.map((g) => (1 + g) * 0.9999 ** 2 - 1)), 3)} (h8: 86 trades, 0.524% gross, 0.50% net)`);
  console.log(`\nSEC tickers ${secTickers.length}; dropped by name filter ${nameDropped} (README literal rule: ${nameDroppedReadme}); no bars (either file empty/missing) ${noBars}; panel ${K}; zero-volume bars dropped ${zeroVol}`);
  for (const [lab, ext] of [['primary (first .. last+365, dated note 1)', true], ['README (first .. last, README name rule)', false]]) {
    const el = eligibility(ext ? 'main' : 'readme');
    console.log(`\n${lab}: stand-in stock-days ${el.standIn ?? 0}`);
    const { rank, nElig } = ranks(el);
    const w = nElig.slice(START, LAST + 1);
    const sortedW = [...w].sort((a, b) => a - b);
    let inA = 0;
    let inB = 0;
    let endA = 0;
    let endB = 0;
    let segSplits = 0;
    let spikes = 0;
    let stockDaysA = 0;
    const spikeList = [];
    for (let k = 0; k < K; k++) {
      const r = rank[k];
      let a = false;
      let b = false;
      for (let i = START; i <= LAST; i++) {
        if (r[i] >= 1 && r[i] <= 500) a = true;
        else if (r[i] > 500) b = true;
      }
      if (!a && !b) continue;
      const st = structure(panel[k].C);
      const lastBar = st.bars.at(-1);
      if (a) inA++;
      else inB++;
      if (lastBar < LAST) a ? endA++ : endB++;
      const segs = new Set(st.bars.map((i) => st.segStart[i])).size;
      segSplits += segs - 1;
      if (!ext) continue;
      const C = panel[k].C;
      for (let i = START; i < LAST; i++) {
        if (!(r[i] >= 1 && r[i] <= 500) || !Number.isFinite(C[i]) || !Number.isFinite(C[i + 1])) continue;
        const p = st.prevBar[i - 1];
        if (p < 0) continue;
        stockDaysA++;
        const r1 = C[i] / C[p] - 1;
        const r2 = C[i + 1] / C[i] - 1;
        if ((r1 < -0.25 && r2 > 0.33) || (r1 > 0.33 && r2 < -0.25)) {
          spikes++;
          if (spikeList.length < 25) spikeList.push(`${panel[k].t} ${dates[i]} ${pct(r1, 0)}/${pct(r2, 0)}`);
        }
      }
    }
    console.log(`\nEligibility ${lab}: eligible-and-ranked stocks per day (window): min ${sortedW[0]}, median ${sortedW[w.length >> 1]}, max ${sortedW.at(-1)}; days with < 1000: ${w.filter((x) => x < 1000).length}`);
    console.log(`  distinct stocks ever in A (top 500): ${inA}; only ever in B (501-1000): ${inB}; of those, bars end before ${END}: A ${endA}, B-only ${endB}; extra segments (gap > ${SEG_GAP} days) among them: ${segSplits}`);
    if (ext) {
      console.log(`  one-day spikes in group-A stock-days (r_t < -25% and r_t+1 > +33%, or reverse): ${spikes} of ${stockDaysA}`);
      for (const s of spikeList) console.log(`    ${s}`);
      for (const t of ['SIVB', 'SIVBQ', 'TWTR', 'FB', 'META', 'BBBY', 'ATVI', 'AAPL', 'GOOG', 'GOOGL', 'J', 'MLKN', 'EV', 'ETH', 'DLR', 'SHLD', 'GME']) {
        const k = kOf.get(t);
        if (k === undefined) {
          console.log(`  ${t}: not in panel`);
          continue;
        }
        const r = rank[k];
        const ds = [];
        for (let i = START; i <= LAST; i++) if (r[i]) ds.push(i);
        const st = structure(panel[k].C);
        console.log(`  ${t}: ranked on ${ds.length} days${ds.length ? ` (${dates[ds[0]]} .. ${dates[ds.at(-1)]}, best rank ${Math.min(...ds.map((i) => r[i]))})` : ''}; bars ${dates[st.bars[0]]} .. ${dates[st.bars.at(-1)]}`);
      }
    }
  }
  process.exit(0);
}

// --- strategy -----------------------------------------------------------------------------------
console.log(`H15 RSI(2) on liquid single stocks. Window ${dates[START]} .. ${END} (${LAST - START} return days). Panel ${K} tickers with bars (SEC ${secTickers.length}, name-filtered ${nameDropped}, no bars ${noBars}).`);
const t0 = Date.now();
const EL = { main: eligibility('main'), readme: eligibility('readme') };
const RK = { main: ranks(EL.main), readme: ranks(EL.readme) };
const used = new Set();
for (const u of Object.values(RK)) for (let k = 0; k < K; k++) if (u.rank[k].some((r) => r > 0)) used.add(k);
const ST = new Map();
for (const k of used) {
  const { C } = panel[k];
  const st = structure(C);
  const ind = indicators(C, st);
  const Z = residual(C, st);
  const indR = indicators(Z, st);
  ST.set(k, { st, ind, indR });
}
console.log(`Universe built in ${((Date.now() - t0) / 1000).toFixed(0)} s; ${used.size} tickers ever ranked in the top 1000.`);

const groupOf = (r) => (r >= 1 && r <= 500 ? 'A' : r > 500 ? 'B' : null);
const sizeOf = (r) => (r <= 100 ? 'A1 1-100' : r <= 250 ? 'A2 101-250' : r <= 500 ? 'A3 251-500' : 'B 501-1000');

/** Event-level trades for one config, all stocks. */
function runRule(cfg) {
  const { thr = 10, filter = true, lag = false, cap = Infinity, res = false, univ = 'main' } = cfg;
  const rank = RK[univ].rank;
  const trades = [];
  for (const k of used) {
    const { C, RC } = panel[k];
    const { st, ind, indR } = ST.get(k);
    const rsi = res ? indR.rsi : ind.rsi;
    const a5 = res ? indR.a5 : ind.a5;
    const f200 = ind.f200;
    const has = (i) => Number.isFinite(C[i]);
    let pos = null;
    const close = (x, kind) => {
      let g = C[x] / C[pos.e] - 1;
      let haircut = false;
      if (kind === 'end' && (RC[x] < 1 || C[x] / C[pos.e] < 0.5)) {
        g = (1 + g) * 0.7 - 1;
        haircut = true;
      }
      trades.push({ k, ...pos, x, h: x - pos.e, gross: g, kind, haircut });
      pos = null;
    };
    for (let i = START; i <= LAST; i++) {
      if (!has(i)) continue;
      if (pos) {
        let out = false;
        if (i > pos.e) {
          if (lag) out = i - 1 >= pos.e + 1 && has(i - 1) && a5[i - 1] === 1;
          else out = a5[i] === 1;
          if (i - pos.e >= cap) out = true;
        }
        if (out) close(i, 'rule');
        else if (st.segEnd[i] === i && i < LAST) close(i, 'end');
        else if (i === LAST) close(i, 'open');
        continue;
      }
      if (i >= LAST) continue;
      const sd = lag ? i - 1 : i;
      if (!has(sd)) continue;
      if (lag && st.segStart[sd] !== st.segStart[i]) continue;
      const g = groupOf(rank[k][sd]);
      if (!g) continue;
      if (!(rsi[sd] < thr)) continue;
      if (filter && f200[sd] !== 1) continue;
      pos = { e: i, group: g, rank: rank[k][sd], rsi: rsi[sd], sd };
      if (st.segEnd[i] === i) close(i, 'end');
    }
  }
  // the "exit day" re-entry rule: an exit day is skipped for entry by the `continue` above
  return trades;
}

/** Return of a hold from close s for h days for stock k, with the bars-end rule. */
function holdRet(k, s, h) {
  const { C, RC } = panel[k];
  const { st } = ST.get(k);
  const x = s + h;
  const se = st.segEnd[s];
  if (se < x && se < LAST) {
    const ratio = C[se] / C[s];
    return (RC[se] < 1 || ratio < 0.5 ? ratio * 0.7 : ratio) - 1;
  }
  return C[st.prevBar[x]] / C[s] - 1;
}

/** Qualifying random start days for (k, group, filter, univ). */
const startCache = new Map();
function starts(k, g, filter, univ) {
  const key = `${k}|${g}|${filter}|${univ}`;
  if (startCache.has(key)) return startCache.get(key);
  const r = RK[univ].rank[k];
  const { C } = panel[k];
  const { ind } = ST.get(k);
  const out = [];
  for (let s = START; s < LAST; s++)
    if (Number.isFinite(C[s]) && groupOf(r[s]) === g && (!filter || ind.f200[s] === 1)) out.push(s);
  const arr = Int32Array.from(out);
  startCache.set(key, arr);
  return arr;
}
const benchCache = new Map();
function bench(k, g, filter, univ, h) {
  const key = `${k}|${g}|${filter}|${univ}|${h}`;
  if (benchCache.has(key)) return benchCache.get(key);
  const ss = starts(k, g, filter, univ);
  let sum = 0;
  let n = 0;
  for (const s of ss) {
    if (s + h > LAST) break;
    sum += holdRet(k, s, h);
    n++;
  }
  const v = n ? sum / n : NaN;
  benchCache.set(key, v);
  return v;
}

/** EW universe return over a trade's hold (members as of each day's previous close) — filled lazily. */
const ewDaily = {};
function ewSeries(univ, g) {
  const key = `${univ}|${g}`;
  if (ewDaily[key]) return ewDaily[key];
  const rank = RK[univ].rank;
  const r = new Float64Array(D);
  const cnt = new Int32Array(D);
  for (const k of used) {
    const { C, RC } = panel[k];
    const { st } = ST.get(k);
    const rk = rank[k];
    for (let i = START + 1; i <= LAST; i++) {
      if (groupOf(rk[i - 1]) !== g) continue; // members known at i-1's close
      const p = i - 1; // membership needs a bar at i-2... use the bar at i-1 if present
      if (!Number.isFinite(C[p])) continue;
      let v = 0;
      if (Number.isFinite(C[i])) v = C[i] / C[p] - 1;
      else if (st.segEnd[p] === p) {
        const b21 = st.bars[Math.max(0, st.bars.indexOf(p) - 21)];
        if (RC[p] < 1 || RC[p] < 0.5 * RC[b21]) v = -0.3;
      }
      r[i] += v;
      cnt[i]++;
    }
  }
  for (let i = START + 1; i <= LAST; i++) r[i] = cnt[i] ? r[i] / cnt[i] : 0;
  ewDaily[key] = { r, cnt };
  return ewDaily[key];
}

/** Newey-West t of the mean of per-trade values clustered by entry day (Bartlett, lag L). */
function nwT(trades, val, L = NW_LAG) {
  const n = trades.length;
  if (n < 2) return { mean: NaN, t: NaN, tCl: NaN, tIid: NaN, se: NaN };
  const m = mean(trades.map(val));
  const u = new Float64Array(D);
  for (const tr of trades) u[tr.e] += val(tr) - m;
  let v0 = 0;
  for (let i = 0; i < D; i++) v0 += u[i] * u[i];
  let v = v0;
  for (let l = 1; l <= L; l++) {
    let s = 0;
    for (let i = l; i < D; i++) s += u[i] * u[i - l];
    v += 2 * (1 - l / (L + 1)) * s;
  }
  const se = Math.sqrt(v) / n;
  return { mean: m, t: m / se, tCl: m / (Math.sqrt(v0) / n), tIid: tstat(trades.map(val)), se };
}

const netOf = (g, c) => (1 + g) * (1 - c) ** 2 - 1;

function enrich(trades, cfg) {
  const { filter = true, univ = 'main' } = cfg;
  for (const tr of trades) {
    tr.bench = bench(tr.k, tr.group, filter, univ, tr.h);
    tr.year = dates[tr.e].slice(0, 4);
    tr.spyR = spy[tr.x] / spy[tr.e] - 1;
    tr.spyLow = spyInd.rsi[tr.sd] < 10;
    const ew = ewSeries(univ, tr.group).r;
    let g = 1;
    for (let i = tr.e + 1; i <= tr.x; i++) g *= 1 + ew[i];
    tr.ewR = g - 1;
  }
  return trades;
}

function eventStats(trades, c) {
  const ex = (t) => netOf(t.gross, c) - t.bench;
  const nets = trades.map((t) => netOf(t.gross, c));
  const nw = nwT(trades, ex);
  const byDay = new Map();
  for (const t of trades) byDay.set(t.e, (byDay.get(t.e) ?? 0) + ex(t));
  const top5 = new Set([...byDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d));
  const no5 = trades.filter((t) => !top5.has(t.e));
  const nw5 = nwT(no5, ex);
  const sorted = [...nets].sort((a, b) => a - b);
  return {
    n: trades.length,
    perYear: trades.length / ((LAST - START) / 252),
    hold: mean(trades.map((t) => t.h)),
    hit: nets.filter((x) => x > 0).length / (nets.length || 1),
    meanNet: mean(nets),
    median: sorted[sorted.length >> 1],
    worst: sorted[0],
    meanBench: mean(trades.map((t) => t.bench)),
    ex: nw.mean,
    tNW: nw.t,
    tCl: nw.tCl,
    tIid: nw.tIid,
    se: nw.se,
    exNo5: nw5.mean,
    tNo5: nw5.t,
    vsSpy: mean(trades.map((t) => netOf(t.gross, c) - t.spyR)),
    vsEw: mean(trades.map((t) => netOf(t.gross, c) - t.ewR)),
    tVsEw: nwT(trades, (t) => netOf(t.gross, c) - t.ewR).t,
  };
}

function bootstrap(trades, cfg, seed) {
  const { filter = true, univ = 'main' } = cfg;
  const rnd = mulberry32(seed);
  const actual = mean(trades.map((t) => t.gross));
  const pools = trades.map((t) => {
    const ss = starts(t.k, t.group, filter, univ);
    let hi = ss.length;
    while (hi > 0 && ss[hi - 1] + t.h > LAST) hi--;
    return hi;
  });
  const draws = new Float64Array(BOOT);
  for (let b = 0; b < BOOT; b++) {
    let s = 0;
    let n = 0;
    for (let j = 0; j < trades.length; j++) {
      const t = trades[j];
      if (!pools[j]) continue;
      const ss = starts(t.k, t.group, filter, univ);
      s += holdRet(t.k, ss[Math.floor(rnd() * pools[j])], t.h);
      n++;
    }
    draws[b] = s / n;
  }
  const arr = [...draws];
  return { actual, mean: mean(arr), sd: sdev(arr), p: arr.filter((d) => d >= actual).length / BOOT };
}

// --- portfolio ----------------------------------------------------------------------------------
function portfolio(trades, g, N, c, univ = 'main') {
  const cand = new Map();
  for (const t of trades) if (t.group === g) (cand.get(t.e) ?? cand.set(t.e, []).get(t.e)).push(t);
  for (const v of cand.values()) v.sort((a, b) => a.rsi - b.rsi || (panel[a.k].t < panel[b.k].t ? -1 : 1));
  const held = new Map(); // trade -> { shares, last }
  let cash = 1;
  let prevEq = 1;
  const ret = [];
  const expo = [];
  const taken = [];
  let expNow = 0;
  for (let i = START; i <= LAST; i++) {
    if (i > START) cash *= 1 + bilRet[i];
    for (const [t, h] of held) if (Number.isFinite(panel[t.k].C[i])) h.last = panel[t.k].C[i];
    // exits
    for (const [t, h] of held)
      if (t.x === i) {
        cash += h.shares * h.last * (t.haircut ? 0.7 : 1) * (1 - c);
        held.delete(t);
      }
    // entries
    let eq = cash;
    for (const h of held.values()) eq += h.shares * h.last;
    for (const t of cand.get(i) ?? []) {
      if (held.size >= N) break;
      const amt = Math.min(eq / N, cash);
      if (amt <= 1e-12) break;
      cash -= amt;
      const px = panel[t.k].C[i];
      held.set(t, { shares: (amt * (1 - c)) / px, last: px });
      taken.push(t);
      if (t.x === i) {
        cash += amt * (1 - c) * (t.haircut ? 0.7 : 1) * (1 - c);
        held.delete(t);
      }
    }
    eq = cash;
    let inv = 0;
    for (const h of held.values()) inv += h.shares * h.last;
    eq += inv;
    if (i > START) {
      ret.push(eq / prevEq - 1);
      expo.push(expNow);
    }
    expNow = inv / eq;
    prevEq = eq;
  }
  return { ret, expo: mean(expo), taken };
}

function ols(y, x) {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < y.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  // NW(5) se of alpha
  const e = y.map((v, i) => v - a - b * x[i]);
  const n = y.length;
  const L = 5;
  const z = (i) => 1 - (mx * (x[i] - mx)) / (sxx / n); // influence of obs i on alpha, scaled
  const u = e.map((v, i) => v * z(i));
  let s = u.reduce((p, v) => p + v * v, 0);
  for (let l = 1; l <= L; l++) {
    let q = 0;
    for (let i = l; i < n; i++) q += u[i] * u[i - l];
    s += 2 * (1 - l / (L + 1)) * q;
  }
  const seA = Math.sqrt(s) / n;
  return { a, b, tA: a / seA };
}

function pfStats(ret) {
  const bilW = bilRet.slice(START + 1, LAST + 1);
  const ex = ret.map((v, i) => v - bilW[i]);
  return {
    cagr: cagr(ret),
    vol: sdev(ret) * Math.sqrt(252),
    sharpe: (mean(ex) / sdev(ex)) * Math.sqrt(252),
    dd: maxDD(ret),
    worst: Math.min(...ret),
    ex,
  };
}

// --- run ----------------------------------------------------------------------------------------
const CONFIGS = [
  { id: 'P', label: 'P ★ RSI2<10, C>SMA200, exit C>SMA5, same close', cfg: {} },
  { id: 'LAG', label: 'LAG: all decisions on the previous close', cfg: { lag: true } },
  { id: 'T5', label: 'RSI2 < 5', cfg: { thr: 5 } },
  { id: 'T15', label: 'RSI2 < 15', cfg: { thr: 15 } },
  { id: 'NOF', label: 'no 200-day filter', cfg: { filter: false } },
  { id: 'CAP10', label: 'hold cap 10 days', cfg: { cap: 10 } },
  { id: 'RES', label: 'residual (stock - SPY) RSI2 and SMA5 exit', cfg: { res: true } },
  { id: 'UREADME', label: "README's first..last window", cfg: { univ: 'readme' } },
];

const R = {};
for (const c of CONFIGS) {
  const t1 = Date.now();
  R[c.id] = enrich(runRule(c.cfg), c.cfg);
  console.log(`  ${c.id}: ${R[c.id].length} trades (${((Date.now() - t1) / 1000).toFixed(0)} s)`);
}
const DUMP = opt('dump', null);
if (DUMP) {
  const row = (t) => ({ t: panel[t.k].t, e: dates[t.e], x: dates[t.x], g: t.group, rank: t.rank, rsi: t.rsi, gross: t.gross, bench: t.bench, kind: t.kind });
  writeFileSync(DUMP, JSON.stringify(Object.fromEntries(CONFIGS.map((c) => [c.id, R[c.id].map(row)]))));
}

const H = `${padR('', 24)}${pad('n', 7)}${pad('/yr', 6)}${pad('hold', 6)}${pad('hit', 5)}${pad('net', 8)}${pad('bench', 8)}${pad('excess', 8)}${pad('tNW', 7)}${pad('tCl', 7)}${pad('tIid', 7)}${pad('3se', 7)}${pad('vsEW', 8)}${pad('tEW', 6)}${pad('vsSPY', 8)}`;
const L = (name, s) =>
  `${padR(name, 24)}${pad(s.n, 7)}${pad(s.perYear.toFixed(0), 6)}${pad(s.hold.toFixed(1), 6)}${pad(pct(s.hit, 0), 5)}${pad(pct(s.meanNet, 2), 8)}${pad(pct(s.meanBench, 2), 8)}${pad(pct(s.ex, 2), 8)}${pad(f2(s.tNW), 7)}${pad(f2(s.tCl), 7)}${pad(f2(s.tIid), 7)}${pad(pct(3 * s.se, 2), 7)}${pad(pct(s.vsEw, 2), 8)}${pad(f2(s.tVsEw), 6)}${pad(pct(s.vsSpy, 2), 8)}`;
const legend =
  '(net = mean net trade; bench = same-stock random hold of the same length on qualifying days; excess = net − bench; tNW Newey–West lag 10 on entry days; tCl clustered by entry day; tIid naive; 3se = minimum detectable excess at t 3; vsEW / vsSPY = net − equal-weight group / SPY over the same hold)';

const byGroup = (trades, g) => trades.filter((t) => t.group === g);

console.log('\n=== Primary P: event level (every signal, no slot limit) ===');
console.log(legend);
console.log(H);
for (const g of ['A', 'B'])
  for (const [k, c] of Object.entries(COSTS[g])) console.log(L(`${g} ${k} ${bp(c, 0)}bp`, eventStats(byGroup(R.P, g), c)));

for (const g of ['A', 'B']) {
  const tr = byGroup(R.P, g);
  const c = COSTS[g].primary;
  const s = eventStats(tr, c);
  const kinds = { rule: 0, end: 0, open: 0 };
  for (const t of tr) kinds[t.kind]++;
  const hair = tr.filter((t) => t.haircut);
  const big = tr.filter((t) => Math.abs(t.gross) > 0.5);
  console.log(`\nP group ${g}: median net ${pct(s.median, 2)}, worst ${pct(s.worst, 1)}; without the 5 best entry days: excess ${pct(s.exNo5, 3)} tNW ${f2(s.tNo5)}`);
  console.log(`  exits: rule ${kinds.rule}, bars end ${kinds.end} (haircut −30%: ${hair.length}; mean gross of bars-end trades ${pct(mean(tr.filter((t) => t.kind === 'end').map((t) => t.gross)), 2)}), open at end ${kinds.open}`);
  console.log(`  |gross| > 50%: ${big.length}${big.length ? `: ${big.slice(0, 12).map((t) => `${panel[t.k].t} ${dates[t.e]} ${pct(t.gross, 0)}`).join(', ')}` : ''}`);
  const b = bootstrap(tr, {}, 7 + g.charCodeAt(0));
  console.log(`  bootstrap (${BOOT} draws, iid, ignores cross-trade correlation): mean gross trade ${pct(b.actual, 3)}; random same-stock holds ${pct(b.mean, 3)} ± ${pct(b.sd, 3)}; p ${b.p.toFixed(4)}`);
}

console.log('\n=== P by entry year (primary cost; excess with NW t) ===');
for (const g of ['A', 'B']) {
  const tr = byGroup(R.P, g);
  const c = COSTS[g].primary;
  const years = [...new Set(tr.map((t) => t.year))].sort();
  let posY = 0;
  let posYs = 0;
  const rows = years.map((y) => {
    const ty = tr.filter((t) => t.year === y);
    const s = eventStats(ty, c);
    const ss = eventStats(ty, COSTS[g].stress);
    if (s.ex > 0) posY++;
    if (ss.ex > 0) posYs++;
    return `  ${y}: n ${pad(s.n, 5)}  net ${pad(pct(s.meanNet, 2), 7)}  bench ${pad(pct(s.meanBench, 2), 7)}  excess ${pad(pct(s.ex, 2), 7)} tNW ${pad(f2(s.tNW), 6)}  hit ${pct(s.hit, 0)}  vsEW ${pad(pct(s.vsEw, 2), 7)}`;
  });
  console.log(`Group ${g}: excess positive in ${posY} of ${years.length} years (at stress cost: ${posYs})`);
  console.log(rows.join('\n'));
}

console.log('\n=== P by size group (rank by 63-day median $ volume at entry; primary cost of the group) ===');
console.log(H);
for (const sg of ['A1 1-100', 'A2 101-250', 'A3 251-500', 'B 501-1000']) {
  const tr = R.P.filter((t) => sizeOf(t.rank) === sg);
  console.log(L(sg, eventStats(tr, COSTS[sg.startsWith('B') ? 'B' : 'A'].primary)));
}

console.log('\n=== Market-wide confound: P split by SPY RSI2 < 10 on the entry day; RES (residual reversal) ===');
console.log(H);
for (const g of ['A', 'B']) {
  const c = COSTS[g].primary;
  const tr = byGroup(R.P, g);
  console.log(L(`${g} P SPY RSI2<10`, eventStats(tr.filter((t) => t.spyLow), c)));
  console.log(L(`${g} P SPY RSI2>=10`, eventStats(tr.filter((t) => !t.spyLow), c)));
  const rr = byGroup(R.RES, g);
  console.log(L(`${g} RES all`, eventStats(rr, c)));
  console.log(L(`${g} RES SPY RSI2>=10`, eventStats(rr.filter((t) => !t.spyLow), c)));
  console.log(
    `  share of P trades entered on SPY RSI2<10 days: ${pct(tr.filter((t) => t.spyLow).length / tr.length, 0)}; P distinct entry days ${new Set(tr.map((t) => t.e)).size}; RES excess at stress ${pct(eventStats(rr, COSTS[g].stress).ex, 2)}`,
  );
}

console.log('\n=== Robustness (information only): event level, primary cost ===');
console.log(H);
for (const c of CONFIGS)
  for (const g of ['A', 'B']) {
    const s = eventStats(byGroup(R[c.id], g), COSTS[g].primary);
    const ss = eventStats(byGroup(R[c.id], g), COSTS[g].stress);
    console.log(`${L(`${c.id} ${g}`, s)}  stress ex ${pct(ss.ex, 2)}`);
  }
for (const c of CONFIGS) console.log(`  ${padR(c.id, 8)} ${c.label}`);
{
  const p = byGroup(R.LAG, 'A');
  const years = [...new Set(p.map((t) => t.year))].sort();
  console.log(`LAG group A excess by year: ${years.map((y) => `${y} ${pct(eventStats(p.filter((t) => t.year === y), COSTS.A.primary).ex, 2)}`).join(', ')}`);
}

console.log('\n=== Portfolios (equal slots, lowest RSI first, cash in BIL) vs equal-weight group ===');
const PH = `${padR('', 26)}${pad('trades', 7)}${pad('expo', 6)}${pad('CAGR', 8)}${pad('vol', 7)}${pad('Sharpe', 7)}${pad('maxDD', 8)}${pad('worst', 7)}${pad('alpha/yr', 9)}${pad('beta', 6)}${pad('tA', 6)}${pad('aSPY/yr', 9)}${pad('tAS', 6)}`;
const PL = (name, pf, st, reg, regS) =>
  `${padR(name, 26)}${pad(pf.taken.length, 7)}${pad(pct(pf.expo, 0), 6)}${pad(pct(st.cagr), 8)}${pad(pct(st.vol), 7)}${pad(f2(st.sharpe), 7)}${pad(pct(st.dd), 8)}${pad(pct(st.worst), 7)}${pad(pct(reg.a * 252), 9)}${pad(f2(reg.b), 6)}${pad(f2(reg.tA), 6)}${pad(pct(regS.a * 252), 9)}${pad(f2(regS.tA), 6)}`;
const spyRet = Array.from({ length: LAST - START }, (_, j) => spy[START + 1 + j] / spy[START + j] - 1);
const bilW = bilRet.slice(START + 1, LAST + 1);
const spyEx = spyRet.map((v, i) => v - bilW[i]);
const pfRuns = [
  ['P', 20],
  ['P', 10],
  ['P', 50],
  ['LAG', 20],
  ['T5', 20],
  ['T15', 20],
  ['NOF', 20],
  ['CAP10', 20],
  ['RES', 20],
  ['UREADME', 20],
];
const pfKeep = {};
for (const g of ['A', 'B']) {
  const ew = ewSeries('main', g).r.slice(START + 1, LAST + 1);
  const ewArr = [...ew];
  const ewSt = pfStats(ewArr);
  const ewEx = ewSt.ex;
  console.log(`\nGroup ${g} (costs ${Object.values(COSTS[g]).map((c) => bp(c, 0)).join('/')} bp): EW group full exposure: CAGR ${pct(ewSt.cagr)}, vol ${pct(ewSt.vol)}, Sharpe ${f2(ewSt.sharpe)}, maxDD ${pct(ewSt.dd)}; SPY: CAGR ${pct(cagr(spyRet))}, Sharpe ${f2(pfStats(spyRet).sharpe)}, maxDD ${pct(maxDD(spyRet))}`);
  console.log(PH);
  for (const [id, N] of pfRuns) {
    const costs = id === 'P' && N === 20 ? Object.entries(COSTS[g]) : [['primary', COSTS[g].primary]];
    for (const [ck, c] of costs) {
      const pf = portfolio(R[id], g, N, c);
      const st = pfStats(pf.ret);
      const reg = ols(st.ex, ewEx);
      const regS = ols(st.ex, spyEx);
      console.log(PL(`${id} N${N} ${ck}`, pf, st, reg, regS));
      if (id === 'P' && N === 20 && ck === 'primary') pfKeep[g] = { pf, st, ewArr, ewSt };
      if (id === 'P' && N === 20 && ck === 'primary') {
        const mix = ewArr.map((v, i) => pf.expo * v + (1 - pf.expo) * bilW[i]);
        const ms = pfStats(mix);
        console.log(`${padR(`  same-exposure EW (${pct(pf.expo, 0)})`, 26)}${pad('', 13)}${pad(pct(ms.cagr), 8)}${pad(pct(ms.vol), 7)}${pad(f2(ms.sharpe), 7)}${pad(pct(ms.dd), 8)}${pad(pct(ms.worst), 7)}`);
        const tk = pf.taken;
        const s = eventStats(tk, c);
        console.log(`  trades taken by the portfolio: ${tk.length} of ${byGroup(R.P, g).length}; their excess ${pct(s.ex, 2)} tNW ${f2(s.tNW)}, hold ${s.hold.toFixed(1)}`);
        const ret = pf.ret;
        const diff = ret.map((v, i) => v - mix[i]);
        console.log(`  daily strategy − same-exposure EW: ${bp(mean(diff), 2)} bp/day, t ${f2(tstat(diff))}`);
      }
    }
  }
}

console.log('\n=== P portfolio N20 by year (primary cost): strategy, same-exposure EW, EW, SPY ===');
for (const g of ['A', 'B']) {
  const { pf, ewArr } = pfKeep[g];
  const yrs = {};
  for (let j = 0; j < pf.ret.length; j++) {
    const y = dates[START + 1 + j].slice(0, 4);
    const Y = (yrs[y] ??= { s: [], m: [], e: [], p: [] });
    Y.s.push(pf.ret[j]);
    Y.m.push(pf.expo * ewArr[j] + (1 - pf.expo) * bilW[j]);
    Y.e.push(ewArr[j]);
    Y.p.push(spyRet[j]);
  }
  let beat = 0;
  const rows = Object.entries(yrs).map(([y, Y]) => {
    const a = compound(Y.s) - 1;
    const m = compound(Y.m) - 1;
    if (a > m) beat++;
    return `  ${y}: ${pad(pct(a), 7)}  mix ${pad(pct(m), 7)}  EW ${pad(pct(compound(Y.e) - 1), 7)}  SPY ${pad(pct(compound(Y.p) - 1), 7)}`;
  });
  console.log(`Group ${g}: strategy beat the same-exposure mix in ${beat} of ${rows.length} years`);
  console.log(rows.join('\n'));
}

// pass rule
{
  const tr = byGroup(R.P, 'A');
  const s = eventStats(tr, COSTS.A.primary);
  const ss = eventStats(tr, COSTS.A.stress);
  const years = [...new Set(tr.map((t) => t.year))].sort();
  const posY = years.filter((y) => eventStats(tr.filter((t) => t.year === y), COSTS.A.primary).ex > 0).length;
  const { st, ewSt, pf } = pfKeep.A;
  const ewEx = ewSt.ex;
  const reg = ols(st.ex, ewEx);
  const lag = eventStats(byGroup(R.LAG, 'A'), COSTS.A.primary);
  console.log('\n=== Pass rule (P, group A) ===');
  console.log(`1. mean excess ${pct(s.ex, 3)} > 0 with NW t ${f2(s.tNW)} >= 3: ${s.ex > 0 && s.tNW >= 3 ? 'yes' : 'NO'}`);
  console.log(`2. excess positive in ${posY} of ${years.length} years (need 7): ${posY >= 7 ? 'yes' : 'NO'}`);
  console.log(`3. excess at stress (5 bp) ${pct(ss.ex, 3)} > 0: ${ss.ex > 0 ? 'yes' : 'NO'}`);
  const verdict = s.ex <= 0 ? 'FAIL' : s.ex > 0 && s.tNW >= 3 && posY >= 7 && ss.ex > 0 ? 'PASS' : 'INCONCLUSIVE';
  console.log(`Verdict: ${verdict}`);
  console.log('Worth trading:');
  console.log(`4. portfolio Sharpe ${f2(st.sharpe)} > EW (same-exposure) Sharpe ${f2(ewSt.sharpe)}: ${st.sharpe > ewSt.sharpe ? 'yes' : 'NO'}`);
  console.log(`5. alpha on EW ${pct(reg.a * 252)} /yr (t ${f2(reg.tA)}) > 0: ${reg.a > 0 ? 'yes' : 'NO'}`);
  console.log(`6. LAG mean excess ${pct(lag.ex, 3)} (t ${f2(lag.tNW)}) > 0: ${lag.ex > 0 ? 'yes' : 'NO'}`);
  console.log(`(portfolio exposure ${pct(pf.expo, 0)})`);
}
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
