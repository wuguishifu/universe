// h14: post-earnings announcement drift sorted on the earnings-announcement return (EAR).
// Pre-registered in research/hypotheses/h14.md.
// usage: node --max-old-space-size=12000 research/tools/h14-pead.mjs [data dir]
import fs from 'node:fs';

const dataDir = process.argv[2] ?? 'data';
const MIN_HISTORY = 42; // raw bars needed in the 63 sessions before a date
const DV_WINDOW = 63;
const MAX_GAP_DAYS = 30;
const MAX_HOLD = 120;
const REPEAT_SESSIONS = 5;
const MIN_BREAKPOINT_EVENTS = 100;
const DELIST_HAIRCUT = 0.7;
const GROUPS = [
  ['full (top 3000)', 1, 3000],
  ['top 500', 1, 500],
  ['501-1000', 501, 1000],
  ['1001-3000', 1001, 3000],
];

const day = (date) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const tryBars = (p) => {
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, 'utf8');
  if (txt.length < 3) return null;
  const bars = JSON.parse(txt);
  return bars.length ? bars : null;
};

// --- Market calendar (SPY's dates) and benchmarks ------------------------------------------------
const spyBars = tryBars(`${dataDir}/daily/SPY.json`);
const dates = spyBars.map((b) => b.t.slice(0, 10));
const D = dates.length;
const lastDate = dates[D - 1];
const dateIdx = new Map(dates.map((d, i) => [d, i]));
const dayNum = Float64Array.from(dates, day);
const align = (bars, field) => {
  const a = new Float64Array(D).fill(NaN);
  if (!bars) return a;
  for (const b of bars) {
    const i = dateIdx.get(b.t.slice(0, 10));
    if (i !== undefined) a[i] = b[field];
  }
  return a;
};
const bench = {};
for (const t of ['SPY', 'IWM', 'BIL']) bench[t] = align(tryBars(`${dataDir}/daily/${t}.json`), 'c');
const benchRet = {};
for (const t of Object.keys(bench)) {
  benchRet[t] = new Float64Array(D);
  for (let i = 1; i < D; i++) {
    const r = bench[t][i] / bench[t][i - 1] - 1;
    benchRet[t][i] = Number.isFinite(r) ? r : 0;
  }
}

// Session close times, for mapping acceptance time to the first tradable session.
const calendar = readJson(`${dataDir}/calendar.json`);
const closeTime = new Map(calendar.map((c) => [c.date, c.close]));
const calDates = calendar.map((c) => c.date);

// --- Issuers, tickers and names -----------------------------------------------------------------
const pairs = readJson(`${dataDir}/universe/sec-issuer-tickers.json`);
const EXCL = /\b(ETFs?|Funds?|Notes|Warrants?|Preferred (Stock|Shares))\b/i;
const KEEP_TRUST = /\b(Inc|Corp|Corporation|Incorporated|Realty|Property|Properties|REIT|Lodging|Hospitality|Mortgage|Residential|Healthcare|Real Estate|Hotel|Storage)\b/i;
const badName = (n) => EXCL.test(n ?? '') || (/\bTrust\b/i.test(n ?? '') && !KEEP_TRUST.test(n ?? ''));
const badShape = (t) => /\.(U|WS|W|R|RT)$/.test(t) || /^[A-Z]{4}[UWR]$/.test(t);
// README Round 3 correction 1 (h14.md note 3): Alpaca's active name belongs to the symbol's current
// owner, so it is used only when the ticker's SEC company still files in 2026; otherwise the SEC name.
const alpacaActive = new Map(readJson(`${dataDir}/universe/assets-active.json`).map((a) => [a.symbol, a.name ?? '']));
const latestLast = new Map();
for (const p of pairs) if (!(latestLast.get(p.ticker) >= p.last)) latestLast.set(p.ticker, p.last);
for (const p of pairs) {
  const useAlpaca = alpacaActive.has(p.ticker) && latestLast.get(p.ticker) >= '2026-01-01' && p.last >= '2026-01-01';
  p.ok = !badName(useAlpaca ? alpacaActive.get(p.ticker) : p.name) && !badShape(p.ticker);
}
const pairsByTicker = new Map();
const pairsByCik = new Map();
for (const p of pairs) {
  if (!pairsByTicker.has(p.ticker)) pairsByTicker.set(p.ticker, []);
  pairsByTicker.get(p.ticker).push(p);
  if (!pairsByCik.has(p.cik)) pairsByCik.set(p.cik, []);
  pairsByCik.get(p.cik).push(p);
}

// --- Load prices for every SEC-issuer ticker ----------------------------------------------------
// README Round 3 corrections (h14.md note 3): a zero-volume raw bar is a stale print, treated as no
// bar; a day counts as a bar only if both the adjusted and the raw series have it; a one-day spike
// that reverses the next day (adjusted |log move| > ln 2, and the next bar undoes > 80% of it) is a
// bad print and is treated as no bar.
const tickers = [...pairsByTicker.keys()].sort();
const px = new Map(); // ticker -> {adj, raw, vol, bad, dvMed, rank, cover}
let loadedT = 0;
const dataFixes = { zeroVolume: 0, spikes: 0, spikeList: [] };
for (const t of tickers) {
  const adjBars = tryBars(`${dataDir}/daily/${t}.json`);
  const rawBars = adjBars && tryBars(`${dataDir}/daily-raw/${t}.json`);
  if (!adjBars || !rawBars) continue;
  const adj = align(adjBars, 'c');
  const raw = new Float32Array(align(rawBars, 'c'));
  const vol = new Float32Array(align(rawBars, 'v'));
  for (let i = 0; i < D; i++) {
    if (vol[i] === 0) dataFixes.zeroVolume++;
    if (!(adj[i] > 0 && raw[i] > 0 && vol[i] > 0)) {
      adj[i] = NaN;
      raw[i] = NaN;
      vol[i] = NaN;
    }
  }
  {
    const bars = [];
    for (let i = 0; i < D; i++) if (adj[i] > 0) bars.push(i);
    for (let j = 1; j + 1 < bars.length; j++) {
      const [a, i, b] = [bars[j - 1], bars[j], bars[j + 1]];
      if (!(adj[a] > 0)) continue; // previous bar already removed
      const la = Math.log(adj[i] / adj[a]);
      const lb = Math.log(adj[b] / adj[i]);
      if (Math.abs(la) > Math.LN2 && la * lb < 0 && Math.abs(lb) > 0.8 * Math.abs(la)) {
        dataFixes.spikes++;
        if (dataFixes.spikeList.length < 30) dataFixes.spikeList.push(`${t} ${dates[i]} ${(Math.exp(la) - 1).toFixed(2)}/${(Math.exp(lb) - 1).toFixed(2)}`);
        adj[i] = NaN;
        raw[i] = NaN;
        vol[i] = NaN;
      }
    }
  }
  // Price-integrity flag (h14.md note 2): the adjusted close more than doubles or halves in a day
  // while the raw close moves by a different factor of more than 1.5 (bad adjustment, or the
  // symbol moving to another security without a gap).
  const bad = new Uint8Array(D);
  let pv = -1;
  for (let i = 0; i < D; i++) {
    if (!(adj[i] > 0)) continue;
    if (pv >= 0) {
      const la = Math.log(adj[i] / adj[pv]);
      const lr = Math.log(raw[i] / raw[pv]);
      if (Math.abs(la) > Math.LN2 && Math.abs(la - lr) > Math.log(1.5)) bad[i] = 1;
    }
    pv = i;
  }
  px.set(t, { t, adj, raw, vol, bad, cover: new Uint8Array(D) });
  if (++loadedT % 2000 === 0) console.error(`loaded ${loadedT}`);
}
console.error(`loaded ${loadedT} tickers with adjusted and raw bars`);

// Rolling median raw dollar volume over the 63 sessions before each date (incremental sorted window).
for (const [, p] of px) {
  const med = new Float32Array(D).fill(NaN);
  const win = [];
  const dv = (i) => {
    const v = p.raw[i] * p.vol[i];
    return Number.isFinite(v) ? v : NaN;
  };
  const find = (v) => {
    let lo = 0;
    let hi = win.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (win[m] < v) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  for (let i = 1; i < D; i++) {
    const add = dv(i - 1);
    if (!Number.isNaN(add)) win.splice(find(add), 0, add);
    if (i - 1 - DV_WINDOW >= 0) {
      const old = dv(i - 1 - DV_WINDOW);
      if (!Number.isNaN(old)) win.splice(find(old), 1);
    }
    if (win.length >= MIN_HISTORY) med[i] = win[win.length >> 1];
  }
  p.dvMed = med;
  p.rank = new Uint16Array(D); // 0 = not eligible or rank > 65535
}

// --- Company identity: CIK -> ticker on each day (README Round 3 corrections, h14.md note 3) ------
// Window of a pair: first .. last + 365 days, cut the day before a later pair of the same CIK, or a
// later pair of another CIK on the same ticker, starts trading (a bar within 21 sessions of its first
// date). On each day a CIK maps to its open pair with bars and the most filings. If its open pairs have
// no bars, the CIK's latest ticker stands in, if that ticker's bars run without a gap of more than 10
// sessions from that day to its own first filing (a rename whose history Alpaca keeps under the new
// symbol).
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const firstIdx = (d) => {
  let lo = 0;
  let hi = D;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (dates[m] < d) lo = m + 1;
    else hi = m;
  }
  return lo; // D if after the data
};
const tradesFrom = (t, d) => {
  const p = px.get(t);
  if (!p) return false;
  const i0 = firstIdx(d);
  for (let i = i0; i < Math.min(D, i0 + 21); i++) if (p.adj[i] > 0) return true;
  return false;
};
for (const p of pairs) p.end = addDays(p.last, 365);
for (const p of pairs) {
  const later = [
    ...(pairsByCik.get(p.cik) ?? []).filter((q) => q !== p && q.first > p.last),
    ...(pairsByTicker.get(p.ticker) ?? []).filter((q) => q.cik !== p.cik && q.first > p.last),
  ];
  for (const q of later) {
    if (!tradesFrom(q.ticker, q.first)) continue;
    const cut = addDays(q.first, -1);
    if (cut < p.end) p.end = cut;
  }
}
const segInfo = (p) => {
  // segStart[i] for the last bar at or before i, -1 if none; gaps > 10 sessions start a new segment.
  const seg = new Int32Array(D).fill(-1);
  let last = -1;
  let s = -1;
  for (let i = 0; i < D; i++) {
    if (p.adj[i] > 0) {
      if (last < 0 || i - last > 10) s = i;
      last = i;
    }
    seg[i] = last >= 0 && i - last <= 10 ? s : -1;
  }
  return seg;
};
const cikTicker = new Map(); // cik -> Array(D) of ticker or null
let standInDays = 0;
for (const [cik, list] of pairsByCik) {
  const ok = list.filter((p) => p.ok);
  if (!ok.length) continue;
  const withBars = ok.filter((p) => px.has(p.ticker)).sort((a, b) => b.filings - a.filings || a.ticker.localeCompare(b.ticker));
  const noBars = ok.filter((p) => !px.has(p.ticker));
  const latest = [...withBars].sort((a, b) => b.first.localeCompare(a.first))[0];
  let latestSeg = null;
  let latestSegAtFirst = -2;
  const arr = new Array(D).fill(null);
  let any = false;
  for (let i = 0; i < D; i++) {
    const d = dates[i];
    const w = withBars.find((p) => p.first <= d && d <= p.end);
    if (w) {
      arr[i] = w.ticker;
      px.get(w.ticker).cover[i] = 1;
      any = true;
      continue;
    }
    if (!latest || !noBars.some((p) => p.first <= d && d <= p.end)) continue;
    if (latestSeg === null) {
      latestSeg = segInfo(px.get(latest.ticker));
      const fi = Math.min(D - 1, firstIdx(latest.first));
      latestSegAtFirst = latestSeg[fi];
    }
    if (i < firstIdx(latest.first) && latestSeg[i] >= 0 && latestSeg[i] === latestSegAtFirst) {
      arr[i] = latest.ticker;
      px.get(latest.ticker).cover[i] = 1;
      standInDays++;
      any = true;
    }
  }
  if (any) cikTicker.set(cik, arr);
}

// Two CIKs on the same ticker on the same day (h14.md note 3): a CIK that has another open, priced,
// unclaimed ticker that day moves to it (old Crane Co. -> CXT while the new Crane Co. takes CR);
// otherwise the pair with the most filings keeps the ticker and the other CIK is unmapped that day.
const conflictDays = new Set(); // `${cik}|${i}`
{
  const ciks = [...cikTicker.keys()];
  const owner = new Map(); // ticker -> Int32Array(D) of index into ciks + 1
  const claims = []; // [ticker, i]
  const slot = (t) => owner.get(t) ?? owner.set(t, new Int32Array(D)).get(t);
  ciks.forEach((cik, c) => {
    const arr = cikTicker.get(cik);
    for (let i = 0; i < D; i++) {
      const t = arr[i];
      if (!t) continue;
      const o = slot(t);
      if (o[i] && o[i] !== c + 1) claims.push([t, i]);
      else o[i] = c + 1;
    }
  });
  const filingsOf = (cik, t) => (pairsByCik.get(cik) ?? []).find((p) => p.ticker === t)?.filings ?? 0;
  const done = new Set();
  let moved = 0;
  for (const [t, i] of claims) {
    if (done.has(`${t}|${i}`)) continue;
    done.add(`${t}|${i}`);
    const d = dates[i];
    let claimants = ciks.filter((cik) => cikTicker.get(cik)[i] === t);
    for (const cik of [...claimants]) {
      if (claimants.length < 2) break;
      const alt = (pairsByCik.get(cik) ?? []).filter(
        (p) => p.ok && p.ticker !== t && px.has(p.ticker) && p.first <= d && d <= p.end && !(owner.get(p.ticker)?.[i]),
      )[0];
      if (alt) {
        cikTicker.get(cik)[i] = alt.ticker;
        slot(alt.ticker)[i] = ciks.indexOf(cik) + 1;
        px.get(alt.ticker).cover[i] = 1;
        claimants = claimants.filter((x) => x !== cik);
        moved++;
      }
    }
    if (claimants.length > 1) {
      claimants.sort((a, b) => filingsOf(b, t) - filingsOf(a, t));
      for (const cik of claimants.slice(1)) {
        cikTicker.get(cik)[i] = null;
        conflictDays.add(`${cik}|${i}`);
      }
    }
  }
  console.error(`ticker claims by two CIKs: ${claims.length} ticker-days; moved to another ticker: ${moved}; unmapped: ${conflictDays.size}`);
}

// Point-in-time rank on each date i (data through i-1).
const universeSize = new Int32Array(D);
{
  const list = [...px.values()];
  for (let i = 1; i < D; i++) {
    const elig = [];
    for (const p of list) {
      if (!p.cover[i]) continue;
      if (!(p.raw[i - 1] >= 5)) continue;
      const m = p.dvMed[i];
      if (!(m > 0)) continue;
      elig.push([m, p]);
    }
    elig.sort((a, b) => b[0] - a[0]);
    universeSize[i] = elig.length;
    for (let k = 0; k < elig.length && k < 65535; k++) elig[k][1].rank[i] = k + 1;
  }
}

// --- Events --------------------------------------------------------------------------------------
const filings = fs
  .readFileSync(`${dataDir}/sec/earnings-8k.jsonl`, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

/** Index (into `dates`) of the first tradable session after acceptance, or -1. */
function firstSession(accepted) {
  const d = accepted.slice(0, 10);
  const hm = accepted.slice(11, 16);
  // first calendar trading date >= d
  let lo = 0;
  let hi = calDates.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (calDates[m] < d) lo = m + 1;
    else hi = m;
  }
  let k = lo;
  if (k < calDates.length && calDates[k] === d && hm >= closeTime.get(d)) k++;
  if (k >= calDates.length) return -1;
  const i = dateIdx.get(calDates[k]);
  return i === undefined ? -1 : i;
}

const cov = {
  filings: filings.length,
  amendments: 0,
  noAcceptance: 0,
  outsideData: 0, // s0 before 2016-01-04 or after the last bar
  repeats: 0,
  unmapped: 0,
  tickerConflict: 0,
  duplicateTickerSession: 0,
  noPrices: 0,
  nameFilter: 0,
  standIn: 0,
  noTradeBars: 0,
  priceIntegrity: 0,
  mappedPriced: 0,
  notInUniverse: { under5: 0, shortHistory: 0, rankOver3000: 0 },
  inUniverse: 0,
};
const dropped = []; // {reason, cik, name, ticker, filed}
const nameOfCik = new Map();
for (const p of pairs) if (!nameOfCik.has(p.cik) || p.filings > nameOfCik.get(p.cik).f) nameOfCik.set(p.cik, { n: p.name, f: p.filings });

// Step 1: amendments, timing, repeats (per CIK, in s0 order).
const byCik = new Map();
for (const f of filings) {
  if (f.form !== '8-K') {
    cov.amendments++;
    continue;
  }
  if (!f.accepted) {
    cov.noAcceptance++;
    continue;
  }
  const s0 = firstSession(f.accepted);
  if (s0 < 0) {
    cov.outsideData++;
    continue;
  }
  f.s0 = s0;
  if (!byCik.has(f.cik)) byCik.set(f.cik, []);
  byCik.get(f.cik).push(f);
}
const kept = [];
for (const [, list] of byCik) {
  list.sort((a, b) => a.s0 - b.s0 || a.accepted.localeCompare(b.accepted));
  let prev = -1e9;
  for (const f of list) {
    if (f.s0 - prev <= REPEAT_SESSIONS) {
      cov.repeats++;
      continue;
    }
    prev = f.s0;
    kept.push(f);
  }
}

// Step 2: CIK -> ticker on s0 (the identity map above).
const events = [];
const seen = new Set();
const openOn = (list, d, okOnly) => list.some((p) => (!okOnly || p.ok) && p.first <= d && d <= p.end);
for (const f of kept) {
  const s0 = f.s0;
  const list = pairsByCik.get(f.cik) ?? [];
  const arr = cikTicker.get(f.cik);
  const ticker = arr?.[s0] ?? null;
  const dS0 = dates[s0];
  if (!ticker) {
    const reason = conflictDays.has(`${f.cik}|${s0}`) ? 'ticker conflict' : openOn(list, dS0, true) ? 'no prices' : openOn(list, dS0, false) ? 'name filter' : 'unmapped';
    if (reason === 'ticker conflict') cov.tickerConflict++;
    else if (reason === 'no prices') cov.noPrices++;
    else if (reason === 'name filter') cov.nameFilter++;
    else cov.unmapped++;
    dropped.push({ reason, cik: f.cik, name: nameOfCik.get(f.cik)?.n, ticker: list.map((p) => `${p.ticker} ${p.first}..${p.last}`).join('; '), filed: f.filed });
    continue;
  }
  const pair = list.find((p) => p.ticker === ticker) ?? list[0];
  const key = `${ticker}|${s0}`;
  if (seen.has(key)) {
    cov.duplicateTickerSession++;
    continue;
  }
  seen.add(key);
  const p = px.get(ticker);
  if (s0 >= 1 && s0 + 2 < D && (p.bad[s0 - 1] || p.bad[s0] || p.bad[s0 + 1] || p.bad[s0 + 2])) {
    cov.priceIntegrity++;
    dropped.push({ reason: 'price integrity', cik: f.cik, name: pair.name, ticker, filed: f.filed });
    continue;
  }
  if (s0 < 2 || s0 + 2 >= D || !(p.adj[s0 - 1] > 0 && p.adj[s0] > 0 && p.adj[s0 + 1] > 0)) {
    // s0 + 2 >= D: no entry possible within the data.
    cov.noTradeBars++;
    dropped.push({ reason: 'no bars around s0', cik: f.cik, name: pair.name, ticker, filed: f.filed });
    continue;
  }
  cov.mappedPriced++;
  if (ticker !== list.filter((q) => q.ok && q.first <= dS0 && dS0 <= q.end).sort((a, b) => b.filings - a.filings)[0]?.ticker) cov.standIn++;
  // Universe membership at s0 (data through s0-1).
  const rank = p.rank[s0];
  if (!rank || rank > 3000) {
    if (!(p.raw[s0 - 1] >= 5)) cov.notInUniverse.under5++;
    else if (!(p.dvMed[s0] > 0)) cov.notInUniverse.shortHistory++;
    else cov.notInUniverse.rankOver3000++;
    continue;
  }
  cov.inUniverse++;
  // The hold ends at the last bar before the CIK stops mapping to this ticker (rename, window end,
  // or the ticker passing to another company).
  let handover = D;
  for (let t = s0 + 1; t < D; t++) if (arr[t] !== ticker) {
    handover = t;
    break;
  }
  const spy = bench.SPY;
  const ret = (a, b) => p.adj[b] / p.adj[a] - spy[b] / spy[a];
  // Volume diagnostic: busiest day in s0-5..s0+5.
  let best = -1;
  let bestV = -1;
  for (let k = Math.max(0, s0 - 5); k <= Math.min(D - 1, s0 + 5); k++) {
    const v = p.vol[k];
    if (v > bestV) {
      bestV = v;
      best = k - s0;
    }
  }
  events.push({
    ticker,
    name: pair.name,
    cik: f.cik,
    accepted: f.accepted,
    s0,
    month: dates[s0].slice(0, 7),
    rank,
    rawPrev: p.raw[s0 - 1],
    ear2: ret(s0 - 1, s0 + 1),
    ear1: ret(s0 - 1, s0),
    ear3: s0 >= 2 && p.adj[s0 - 2] > 0 ? ret(s0 - 2, s0 + 1) : NaN,
    peakVolDay: best,
    handover,
    p,
  });
}

// --- Paths: daily gross returns from the close of s0+2 for up to MAX_HOLD sessions ---------------
for (const ev of events) {
  const { p } = ev;
  const e = ev.s0 + 2;
  ev.e = e;
  if (!(p.adj[e] > 0)) {
    ev.path = null;
    continue;
  }
  const n = Math.min(MAX_HOLD, D - 1 - e);
  const r = new Float64Array(n);
  let lastValid = e;
  let ended = false;
  for (let k = 0; k < n; k++) {
    const t = e + 1 + k;
    if (t >= ev.handover || p.bad[t]) {
      ended = true;
      ev.cut = t >= ev.handover ? 'identity' : 'integrity';
      break;
    }
    if (p.adj[t] > 0) {
      if (dayNum[t] - dayNum[lastValid] > MAX_GAP_DAYS) {
        ended = true;
        break;
      }
      r[k] = p.adj[t] / p.adj[lastValid] - 1;
      lastValid = t;
    }
  }
  if (!ended) {
    // Bars that stop for good (or for > 30 days) after lastValid, before the window or data end.
    let nxt = lastValid + 1;
    while (nxt < D && !(p.adj[nxt] > 0)) nxt++;
    if (nxt >= D) ended = lastValid < D - 1; // stops before the data end
    else ended = dayNum[nxt] - dayNum[lastValid] > MAX_GAP_DAYS;
  }
  ev.path = r;
  ev.lastValid = lastValid; // last bar of the series within the path
  ev.ended = ended; // series ends at lastValid (delisting, merger or reuse gap)
  ev.delistBad = ended && (p.raw[lastValid] < 1 || p.adj[lastValid] < 0.5 * p.adj[e]);
}

// --- Configs ------------------------------------------------------------------------------------
const base = { hold: 60, ear: 'ear2', tiles: 5, minPrice: 5, delist: 'both', bp: 'prior3', borrow: 0.005 };
const CONFIGS = [
  ['PRIMARY', {}],
  ['hold 20', { hold: 20 }],
  ['hold 120', { hold: 120 }],
  ['EAR 1 day', { ear: 'ear1' }],
  ['EAR 3 days', { ear: 'ear3' }],
  ['deciles', { tiles: 10 }],
  ['min price $10', { minPrice: 10 }],
  ['delisting rule off', { delist: 'off' }],
  ['delisting rule long leg only', { delist: 'long' }],
  ['same-month breakpoints (look-ahead)', { bp: 'same' }],
  ['borrow 5%/yr', { borrow: 0.05 }],
].map(([name, o]) => [name, { ...base, ...o }]);
const COSTS = { zero: [0, 0], primary: [0.0002, 0.0005], stress: [0.0005, 0.0015] };

/** Bucket assignment: returns Map event -> 'top'|'bottom' for one portfolio (group filter). */
function assign(cfg, inGroup) {
  const evs = events.filter((ev) => inGroup(ev) && Number.isFinite(ev[cfg.ear]) && ev.rawPrev >= cfg.minPrice);
  const byMonth = new Map();
  for (const ev of evs) {
    if (!byMonth.has(ev.month)) byMonth.set(ev.month, []);
    byMonth.get(ev.month).push(ev[cfg.ear]);
  }
  const months = [...byMonth.keys()].sort();
  const prevMonths = (m, k) => {
    const [y, mo] = m.split('-').map(Number);
    const out = [];
    for (let j = 1; j <= k; j++) {
      const t = y * 12 + (mo - 1) - j;
      out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
    }
    return out;
  };
  const cut = new Map();
  for (const m of months) {
    const pool = cfg.bp === 'same' ? [...byMonth.get(m)] : prevMonths(m, 3).flatMap((x) => byMonth.get(x) ?? []);
    if (pool.length < MIN_BREAKPOINT_EVENTS) continue;
    pool.sort((a, b) => a - b);
    const q = (f) => pool[Math.min(pool.length - 1, Math.floor(f * pool.length))];
    cut.set(m, [q(1 / cfg.tiles), q(1 - 1 / cfg.tiles)]);
  }
  const out = new Map();
  for (const ev of evs) {
    const c = cut.get(ev.month);
    if (!c) continue;
    if (ev[cfg.ear] >= c[1]) out.set(ev, 'top');
    else if (ev[cfg.ear] < c[0]) out.set(ev, 'bottom');
  }
  return out;
}

/** Position daily returns (after costs) for an event under a config; null if no path. */
function positionReturns(ev, cfg, side, cost) {
  if (!ev.path) return null;
  const H = cfg.hold;
  const planned = ev.e + H;
  let x; // last date index held
  let finished;
  let delisted = false;
  if (ev.ended && ev.lastValid < planned) {
    x = ev.lastValid;
    finished = true;
    delisted = ev.delistBad && (cfg.delist === 'both' || (cfg.delist === 'long' && side === 'top'));
  } else if (planned <= D - 1) {
    x = planned;
    finished = true;
  } else {
    x = D - 1;
    finished = false;
  }
  const n = x - ev.e;
  if (n <= 0) return null;
  const r = new Float64Array(n);
  for (let k = 0; k < n; k++) r[k] = ev.path[k];
  // Long: buy at P(1+c), sell at Q(1-c). Short: sell at P(1-c), cover at Q(1+c); the short leg's
  // "stock return" (subtracted in L-S) is then Q(1+c) / (P(1-c)) - 1.
  const sgn = side === 'top' ? 1 : -1;
  r[0] = (1 + r[0]) / (1 + sgn * cost) - 1;
  const exitF = (finished ? 1 - sgn * cost : 1) * (delisted ? DELIST_HAIRCUT : 1);
  r[n - 1] = (1 + r[n - 1]) * exitF - 1;
  return { r, start: ev.e + 1, finished, delisted };
}

const costOf = (ev, level) => COSTS[level][ev.rank <= 500 ? 0 : 1];

/** Daily leg returns (value-weighted since entry). */
function legDaily(list, cfg, side, level) {
  const num = new Float64Array(D);
  const den = new Float64Array(D);
  let nDelist = 0;
  for (const ev of list) {
    const pr = positionReturns(ev, cfg, side, costOf(ev, level));
    if (!pr) continue;
    if (pr.delisted) nDelist++;
    let v = 1;
    for (let k = 0; k < pr.r.length; k++) {
      num[pr.start + k] += v * pr.r[k];
      den[pr.start + k] += v;
      v *= 1 + pr.r[k];
    }
  }
  const r = new Float64Array(D);
  const active = new Uint8Array(D);
  for (let i = 0; i < D; i++) if (den[i] > 0) {
    r[i] = num[i] / den[i];
    active[i] = 1;
  }
  return { r, active, count: den, nDelist };
}

// --- Statistics ----------------------------------------------------------------------------------
/** OLS y = a + b x (x optional) with HC1 t for a (and b), plus Newey-West(3) t for a. */
function ols(y, x) {
  const n = y.length;
  if (!x) {
    const m = y.reduce((s, v) => s + v, 0) / n;
    const e = y.map((v) => v - m);
    const se = Math.sqrt((e.reduce((s, v) => s + v * v, 0) / n) * (n / (n - 1)) / n);
    let lrv = e.reduce((s, v) => s + v * v, 0) / n;
    for (let L = 1; L <= 3; L++) {
      let c = 0;
      for (let i = L; i < n; i++) c += e[i] * e[i - L];
      lrv += 2 * (1 - L / 4) * (c / n);
    }
    return { a: m, t: m / se, tNw: m / Math.sqrt(lrv / n), n };
  }
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const e = y.map((v, i) => v - a - b * x[i]);
  // HC1 sandwich for [1, x]: (X'X)^-1 X' diag(e^2) X (X'X)^-1 * n/(n-2)
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let sx = 0;
  let sxx2 = 0;
  for (let i = 0; i < n; i++) {
    const e2 = e[i] * e[i];
    s0 += e2;
    s1 += e2 * x[i];
    s2 += e2 * x[i] * x[i];
    sx += x[i];
    sxx2 += x[i] * x[i];
  }
  const det = n * sxx2 - sx * sx;
  const inv = [
    [sxx2 / det, -sx / det],
    [-sx / det, n / det],
  ];
  const M = [
    [s0, s1],
    [s1, s2],
  ];
  const mul = (A, B) => [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ];
  const V = mul(mul(inv, M), inv);
  const adj = n / (n - 2);
  const g = e.map((ei, i) => ei * (1 - (mx * (x[i] - mx)) / (sxx / n)));
  let lrv = g.reduce((s, v) => s + v * v, 0) / n;
  for (let L = 1; L <= 3; L++) {
    let c = 0;
    for (let i = L; i < n; i++) c += g[i] * g[i - L];
    lrv += 2 * (1 - L / 4) * (c / n);
  }
  return { a, b, t: a / Math.sqrt(V[0][0] * adj), tb: b / Math.sqrt(V[1][1] * adj), tNw: a / Math.sqrt(lrv / n), n };
}

/** Monthly series from daily leg returns; from the first month both legs are active. */
function monthlySeries(L, S, borrowYr) {
  let first = -1;
  for (let i = 0; i < D; i++) if (L.active[i] && S.active[i]) {
    first = i;
    break;
  }
  if (first < 0) return [];
  const out = [];
  let cur = null;
  for (let i = first; i < D; i++) {
    const m = dates[i].slice(0, 7);
    if (!cur || cur.month !== m) {
      if (cur) out.push(cur);
      cur = { month: m, L: 1, S: 1, SPY: 1, IWM: 1, BIL: 1, days: 0 };
    }
    cur.L *= 1 + (L.active[i] ? L.r[i] : benchRet.BIL[i]);
    cur.S *= 1 + (S.active[i] ? S.r[i] : benchRet.BIL[i]);
    cur.SPY *= 1 + benchRet.SPY[i];
    cur.IWM *= 1 + benchRet.IWM[i];
    cur.BIL *= 1 + benchRet.BIL[i];
    cur.days++;
  }
  if (cur) out.push(cur);
  return out.map((m) => {
    const borrow = (borrowYr * m.days) / 252;
    const o = { month: m.month, L: m.L - 1, S: m.S - 1, SPY: m.SPY - 1, IWM: m.IWM - 1, BIL: m.BIL - 1 };
    o.LS = o.L - o.S - borrow;
    o.LmSPY = o.L - o.SPY;
    return o;
  });
}

function summarize(ms, key) {
  const y = ms.map((m) => m[key]);
  const mean = ols(y);
  const vsSpy = ols(
    key === 'LS' ? y : ms.map((m) => m.L - m.BIL),
    ms.map((m) => m.SPY - m.BIL),
  );
  const vsIwm = ols(
    key === 'LS' ? y : ms.map((m) => m.L - m.BIL),
    ms.map((m) => m.IWM - m.BIL),
  );
  const years = {};
  for (const m of ms) years[m.month.slice(0, 4)] = (years[m.month.slice(0, 4)] ?? 1) * (1 + m[key]);
  let peak = 1;
  let v = 1;
  let mdd = 0;
  for (const r of y) {
    v *= 1 + r;
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  const sorted = [...y].sort((a, b) => b - a);
  const no5 = sorted.slice(5);
  return {
    n: y.length,
    mean,
    vsSpy,
    vsIwm,
    years: Object.fromEntries(Object.entries(years).map(([k, x]) => [k, x - 1])),
    mdd,
    worst: sorted.at(-1),
    meanNo5: no5.reduce((s, x) => s + x, 0) / (no5.length || 1),
    ann: (v ** (12 / y.length)) - 1,
    first: ms[0]?.month,
    last: ms.at(-1)?.month,
  };
}

const pct = (x, d = 2) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

// --- Run -----------------------------------------------------------------------------------------
const log = (...a) => console.log(...a);
log('# h14 PEAD on EAR');
log(`data through ${lastDate}; ${loadedT} SEC-issuer tickers with adjusted+raw bars`);
log(`universe size (eligible, price >= $5) on sample dates: ${['2016-06-01', '2018-06-01', '2020-06-01', '2022-06-01', '2024-06-03', '2026-06-01'].map((d) => `${d} ${universeSize[dateIdx.get(d)] ?? 'n/a'}`).join(', ')}`);
log(`data fixes: zero-volume bars dropped ${dataFixes.zeroVolume}, one-day reversing spikes dropped ${dataFixes.spikes}: ${dataFixes.spikeList.join(', ')}`);
log(`identity: ${cikTicker.size} CIKs mapped to a priced ticker on some day; stand-in ticker-days ${standInDays}`);
log('\n## Coverage');
log(JSON.stringify(cov, null, 1));
const groupOf = (ev) => (ev.rank <= 500 ? 'top 500' : ev.rank <= 1000 ? '501-1000' : '1001-3000');
const ge = {};
for (const ev of events) ge[groupOf(ev)] = (ge[groupOf(ev)] ?? 0) + 1;
log(`events in universe by group: ${JSON.stringify(ge)}`);
const ey = {};
for (const ev of events) ey[dates[ev.s0].slice(0, 4)] = (ey[dates[ev.s0].slice(0, 4)] ?? 0) + 1;
log(`events in universe by year: ${JSON.stringify(ey)}`);
const pv = {};
for (const ev of events) pv[ev.peakVolDay] = (pv[ev.peakVolDay] ?? 0) + 1;
const pvShare = ((pv[0] ?? 0) + (pv[1] ?? 0)) / events.length;
log(`diagnostic: busiest-volume day in s0-5..s0+5 relative to s0: ${JSON.stringify(pv)}; at s0 or s0+1: ${pct(pvShare, 1)}`);
const tm = {};
for (const ev of events) {
  const hm = ev.accepted.slice(11, 16);
  const k = hm < '09:30' ? 'pre-open' : hm < '16:00' ? 'intraday' : 'after close';
  tm[k] = (tm[k] ?? 0) + 1;
}
log(`timing of accepted 8-Ks in universe: ${JSON.stringify(tm)}`);
const ends = events.filter((e) => e.path && e.ended && e.lastValid < e.e + 60);
log(`series cut by the integrity rules: ${JSON.stringify(events.reduce((o, e) => (e.cut ? { ...o, [e.cut]: (o[e.cut] ?? 0) + 1 } : o), {}))}`);
log(`events whose series ends within 60 sessions of entry: ${ends.length}; of those meeting the -30% condition: ${ends.filter((e) => e.delistBad).length}`);

// Data sanity: extreme EARs and extreme 60-day holding returns.
{
  const byEar = [...events].sort((a, b) => b.ear2 - a.ear2);
  const fmt = (e) => `${e.ticker} ${dates[e.s0]} ${pct(e.ear2, 0)}`;
  log(`EAR2 percentiles: ${[0.01, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99].map((q) => `${q * 100}% ${pct(byEar[Math.floor((1 - q) * (byEar.length - 1))].ear2, 1)}`).join(', ')}`);
  log(`largest EAR2: ${byEar.slice(0, 8).map(fmt).join(', ')}`);
  log(`smallest EAR2: ${byEar.slice(-8).map(fmt).join(', ')}`);
  const tot = events
    .filter((e) => e.path)
    .map((e) => ({ e, t: e.path.slice(0, 60).reduce((v, r) => v * (1 + r), 1) - 1 }))
    .sort((a, b) => b.t - a.t);
  log(`largest 60-day returns: ${tot.slice(0, 8).map((x) => `${x.e.ticker} ${dates[x.e.e]} ${pct(x.t, 0)}`).join(', ')}`);
  log(`smallest 60-day returns: ${tot.slice(-8).map((x) => `${x.e.ticker} ${dates[x.e.e]} ${pct(x.t, 0)}`).join(', ')}`);
}

// 20 random dropped (unmapped / conflict / unpriced), fixed seed.
{
  let seed = 14;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  const pool = [...dropped];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const byReason = {};
  for (const d of dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
  log(`\n## Dropped after amendments/repeats: ${JSON.stringify(byReason)}; 20 random:`);
  for (const d of pool.slice(0, 20)) log(`  ${d.filed}  ${d.reason.padEnd(18)} CIK ${d.cik.padEnd(8)} ${String(d.name ?? '').slice(0, 40).padEnd(40)} ${String(d.ticker).slice(0, 70)}`);
}

const groupFilters = GROUPS.map(([name, lo, hi]) => [name, (ev) => ev.rank >= lo && ev.rank <= hi]);
const results = [];
for (const [cname, cfg] of CONFIGS) {
  log(`\n## Config: ${cname} ${JSON.stringify(cfg)}`);
  for (const [gname, gf] of groupFilters) {
    const a = assign(cfg, gf);
    const top = [...a].filter(([, s]) => s === 'top').map(([e]) => e);
    const bot = [...a].filter(([, s]) => s === 'bottom').map(([e]) => e);
    const levels = cname === 'PRIMARY' ? ['zero', 'primary', 'stress'] : ['primary'];
    for (const level of levels) {
      const L = legDaily(top, cfg, 'top', level);
      const S = legDaily(bot, cfg, 'bottom', level);
      const ms = monthlySeries(L, S, cfg.borrow);
      if (!ms.length) {
        log(`  ${gname}: no months`);
        continue;
      }
      const ls = summarize(ms, 'LS');
      const lo = summarize(ms, 'LmSPY');
      results.push({ cname, gname, level, ls, lo, ms, top: top.length, bot: bot.length });
      const yrs = Object.entries(ls.years).map(([k, v]) => `${k} ${pct(v, 1)}`).join(' ');
      log(
        `  ${gname.padEnd(16)} ${level.padEnd(7)} events L/S ${top.length}/${bot.length}, ${ls.first}..${ls.last} (${ls.n} mo)\n` +
          `     L-S  mean/mo ${pct(ls.mean.a)} (t ${f2(ls.mean.t)}, NW ${f2(ls.mean.tNw)})  α vs SPY ${pct(ls.vsSpy.a)} (t ${f2(ls.vsSpy.t)}, β ${f2(ls.vsSpy.b)})  α vs IWM ${pct(ls.vsIwm.a)} (t ${f2(ls.vsIwm.t)})  ann ${pct(ls.ann, 1)} maxDD ${pct(ls.mdd, 1)} worst mo ${pct(ls.worst)} mean w/o 5 best ${pct(ls.meanNo5)}  delist haircuts L/S ${L.nDelist}/${S.nDelist}\n` +
          `     L-SPY mean/mo ${pct(lo.mean.a)} (t ${f2(lo.mean.t)})  α(L) vs SPY ${pct(lo.vsSpy.a)} (t ${f2(lo.vsSpy.t)}, β ${f2(lo.vsSpy.b)})  α(L) vs IWM ${pct(lo.vsIwm.a)} (t ${f2(lo.vsIwm.t)}, β ${f2(lo.vsIwm.b)})\n` +
          `     L-S by year: ${yrs}`,
      );
      if (cname === 'PRIMARY' && level === 'primary') {
        const yrsLo = Object.entries(lo.years).map(([k, v]) => `${k} ${pct(v, 1)}`).join(' ');
        log(`     L-SPY by year: ${yrsLo}`);
        const legs = ols(ms.map((m) => m.L - m.SPY));
        const sh = ols(ms.map((m) => m.SPY - m.S));
        log(`     legs: long-SPY ${pct(legs.a)} (t ${f2(legs.t)}), SPY-short ${pct(sh.a)} (t ${f2(sh.t)})`);
        for (const [pname, lo_, hi_] of [['2016-2020', '2016', '2020'], ['2021-2026', '2021', '2026']]) {
          const sub = ms.filter((m) => m.month.slice(0, 4) >= lo_ && m.month.slice(0, 4) <= hi_);
          const s = summarize(sub, 'LS');
          log(`     sub-period ${pname}: L-S mean/mo ${pct(s.mean.a)} (t ${f2(s.mean.t)}), ${s.n} mo`);
        }
        // Daily L-S stats
        const dl = [];
        for (let i = 0; i < D; i++) if (L.active[i] && S.active[i]) dl.push({ d: dates[i], r: L.r[i] - S.r[i] - cfg.borrow / 252 });
        const ds = ols(dl.map((x) => x.r));
        const worstDay = dl.reduce((w, x) => (x.r < w.r ? x : w), dl[0]);
        log(`     daily L-S: mean ${pct(ds.a, 3)} (t ${f2(ds.t)}), worst day ${worstDay.d} ${pct(worstDay.r)}; avg open positions L/S ~${((top.length * cfg.hold) / dl.length).toFixed(0)}/${((bot.length * cfg.hold) / dl.length).toFixed(0)}`);
      }
    }
  }
}

// --- Event-time drift (primary assignment, gross) -------------------------------------------------
log('\n## Event-time drift: average buy-and-hold return minus SPY from close s0+2 to close s0+k (gross, primary buckets)');
const KS = [3, 5, 10, 15, 20, 30, 40, 50, 60, 62];
const prim = CONFIGS[0][1];
for (const [gname, gf] of groupFilters) {
  const a = assign(prim, gf);
  const curves = { top: new Float64Array(61), bottom: new Float64Array(61) };
  const counts = { top: 0, bottom: 0 };
  for (const [ev, side] of a) {
    const pr = positionReturns(ev, prim, side, 0);
    if (!pr || !pr.finished || ev.e + 60 > D - 1) continue;
    counts[side]++;
    let v = 1;
    let m = 1;
    for (let j = 1; j <= 60; j++) {
      const k = j - 1;
      if (k < pr.r.length) v *= 1 + pr.r[k];
      m *= 1 + benchRet.SPY[ev.e + j] ;
      curves[side][j] += v - m;
    }
  }
  for (const s of ['top', 'bottom']) for (let j = 1; j <= 60; j++) curves[s][j] /= counts[s] || 1;
  log(`  ${gname} (events top ${counts.top}, bottom ${counts.bottom}; day k = s0+k):`);
  log(`     k      ${KS.map((k) => String(k).padStart(7)).join('')}`);
  for (const s of ['top', 'bottom']) log(`     ${s.padEnd(7)}${KS.map((k) => pct(curves[s][k - 2]).padStart(7)).join('')}`);
  log(`     spread ${KS.map((k) => pct(curves.top[k - 2] - curves.bottom[k - 2]).padStart(7)).join('')}`);
}

// --- Information only (added after the full run): the day skipped before entry ---------------------
log('\n## Information only: return minus SPY on day s0+2 (close s0+1 -> close s0+2, skipped before entry), primary buckets');
for (const [gname, gf] of groupFilters) {
  const a = assign(prim, gf);
  const acc = { top: [], bottom: [] };
  for (const [ev, side] of a) {
    const p = ev.p;
    const r = p.adj[ev.s0 + 2] / p.adj[ev.s0 + 1] - bench.SPY[ev.s0 + 2] / bench.SPY[ev.s0 + 1];
    if (Number.isFinite(r)) acc[side].push(r);
  }
  const m = (x) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
  log(`  ${gname.padEnd(16)} top ${pct(m(acc.top))} (n ${acc.top.length})  bottom ${pct(m(acc.bottom))} (n ${acc.bottom.length})  spread ${pct(m(acc.top) - m(acc.bottom))}`);
}
{
  // Spot-check list for an independent recomputation.
  const pick = events.filter((e) => ['AAPL', 'NFLX', 'CROX'].includes(e.ticker) && dates[e.s0] >= '2023-01-01' && dates[e.s0] < '2024-01-01');
  log('\n## Spot check events (ticker, accepted, s0, EAR2, rank)');
  for (const e of pick) log(`  ${e.ticker} ${e.accepted} s0 ${dates[e.s0]} EAR2 ${(e.ear2 * 100).toFixed(3)}% rank ${e.rank}`);
}

// --- Summary table: L-S mean/mo (t) at primary costs, every config x group ------------------------
log('\n## Summary: long-short mean per month (HC1 t), primary costs; L-SPY in brackets');
log(`  ${'config'.padEnd(38)}${GROUPS.map(([g]) => g.padStart(30)).join('')}`);
for (const [cname] of CONFIGS) {
  const cells = GROUPS.map(([g]) => {
    const r = results.find((x) => x.cname === cname && x.gname === g && x.level === 'primary');
    return r ? `${pct(r.ls.mean.a)} (${f2(r.ls.mean.t)}) [${pct(r.lo.mean.a)}]`.padStart(30) : 'n/a'.padStart(30);
  });
  log(`  ${cname.padEnd(38)}${cells.join('')}`);
}

// --- Pass rule -----------------------------------------------------------------------------------
log('\n## Pass rule (PRIMARY, primary costs)');
const get = (g) => results.find((r) => r.cname === 'PRIMARY' && r.level === 'primary' && r.gname === g);
const full = get('full (top 3000)');
const c1 = full.ls.mean.a > 0 && full.ls.mean.t >= 2.5;
const gm = ['top 500', '501-1000', '1001-3000'].map((g) => get(g).ls.mean.a);
const c2 = gm.every((x) => x > 0);
const fullYears = ['2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025'];
const posYears = fullYears.filter((y) => full.ls.years[y] > 0).length;
const c3 = posYears >= 7;
const c4 = gm[2] > gm[0];
log(`1. full L-S mean ${pct(full.ls.mean.a)} t ${f2(full.ls.mean.t)} (need > 0, t >= 2.5): ${c1 ? 'yes' : 'no'}`);
log(`2. L-S mean by group top500/501-1000/1001-3000: ${gm.map((x) => pct(x)).join(' / ')} (all > 0): ${c2 ? 'yes' : 'no'}`);
log(`3. positive full years 2017-2025: ${posYears}/9 (need >= 7): ${c3 ? 'yes' : 'no'}`);
log(`4. 1001-3000 > top 500: ${c4 ? 'yes' : 'no'}; monotone: ${gm[2] > gm[1] && gm[1] > gm[0] ? 'yes' : 'no'}`);
log(`VERDICT: ${c1 && c2 && c3 && c4 ? 'PASS' : !c1 ? 'FAIL' : 'INCONCLUSIVE'}`);
