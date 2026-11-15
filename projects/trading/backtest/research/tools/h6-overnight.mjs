// H6: overnight vs intraday returns of SPY, QQQ, IWM from raw 1-minute bars (auction prints).
// Design and pass rule: research/hypotheses/h6.md.
//
// usage: node research/tools/h6-overnight.mjs [data dir]
import { existsSync, readFileSync } from 'node:fs';

const dataDir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'data';
const FROM = '2016-01-04';
const LAST_DATE = '2026-11-13';
const TICKERS = ['SPY', 'QQQ', 'IWM'];
const FULL_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const COSTS = { zero: 0, primary: 1e-4, stress: 3e-4 };
const SPLIT_F = 0.03;
const EX_THRESHOLD = 2e-4; // |ln F_E/F_D| above this = ex-dividend night (dated note 2)
// dividends missing from the adjusted bars, imputed by rule (dated note 2)
const IMPUTE = { SPY: ["2016-03-18", "2018-06-15"] };
const SPLIT_RAW = 0.15;

// --- time helpers ------------------------------------------------------------------------------

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const nyParts = (ms) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
};
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const { min } = nyParts(noonUtc);
  return noonUtc - min * 60_000;
};

const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date <= LAST_DATE,
);
const calIdx = new Map(calendar.map((d, i) => [d.date, i]));

function loadDaily(t, sub = 'daily') {
  const m = new Map();
  for (const b of JSON.parse(readFileSync(`${dataDir}/${sub}/${t}.json`, 'utf8')))
    m.set(nyParts(Date.parse(b.t)).date, b);
  return m;
}
const bil = loadDaily('BIL');
const bilRet = new Map();
{
  const ds = [...bil.keys()].sort();
  for (let i = 1; i < ds.length; i++) bilRet.set(ds[i], bil.get(ds[i]).c / bil.get(ds[i - 1]).c - 1);
}

// --- per-session prints ------------------------------------------------------------------------

/** Extracts the prints H6 needs from one session file, or null if the file is missing/empty. */
function sessionPrints(ticker, day) {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw.length) return null;
  const mid = nyMidnight(day.date);
  const bars = raw
    .map((b) => ({ m: (Date.parse(b.t) - mid) / 60_000, ...b }))
    .filter((b) => b.m >= 0 && b.m < 24 * 60)
    .sort((a, b) => a.m - b.m);
  const open = hhmm(day.open);
  const close = hhmm(day.close);
  const ahEnd = close === 16 * 60 ? 20 * 60 : 17 * 60;
  const at = (m) => bars.find((b) => b.m === m);
  const firstAtOrAfter = (m, end) => bars.find((b) => b.m >= m && b.m < end);
  const s = { date: day.date, early: close !== 16 * 60 };
  s.open = at(open)?.o ?? null; // opening print (09:30 bar open)
  s.close = at(close)?.o ?? null; // closing print (16:00 / 13:00 bar open)
  s.pre1 = at(close - 1)?.o ?? null; // 15:59 bar open
  const late = firstAtOrAfter(close + 1, ahEnd);
  s.closeLate = late?.o ?? null; // first print at/after 16:01
  s.closeLateMin = late ? late.m - (close + 1) : null;
  const ol = firstAtOrAfter(open + 1, close);
  s.openLate = ol?.o ?? null; // first print at/after 09:31
  s.openLateMin = ol ? ol.m - (open + 1) : null;
  const ah = bars.filter((b) => b.m >= close && b.m < ahEnd);
  s.ahLast = ah.length ? ah.at(-1).c : null; // last after-hours price
  const pm = bars.find((b) => b.m >= 4 * 60 && b.m < open);
  s.pmFirst = pm?.o ?? null; // first pre-market price
  return s;
}

// --- statistics --------------------------------------------------------------------------------

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
const tstat = (a) => (mean(a) / sd(a)) * Math.sqrt(a.length);
function nwT(a, lags = 5) {
  const m = mean(a);
  const n = a.length;
  const e = a.map((x) => x - m);
  let v = e.reduce((x, y) => x + y * y, 0) / n;
  for (let l = 1; l <= lags; l++) {
    let g = 0;
    for (let i = l; i < n; i++) g += e[i] * e[i - l];
    v += 2 * (1 - l / (lags + 1)) * (g / n);
  }
  return m / Math.sqrt(v / n);
}
const growth = (a) => a.reduce((g, r) => g * (1 + r), 1);
const cagr = (a, n = a.length) => growth(a) ** (252 / n) - 1;
function maxDD(a) {
  let g = 1,
    peak = 1,
    dd = 0;
  for (const r of a) {
    g *= 1 + r;
    peak = Math.max(peak, g);
    dd = Math.min(dd, g / peak - 1);
  }
  return dd;
}
const sharpe = (ex) => (mean(ex) / sd(ex)) * Math.sqrt(252);
const dropBest = (a, k = 5) => {
  const idx = a
    .map((r, i) => [r, i])
    .sort((x, y) => y[0] - x[0])
    .slice(0, k)
    .map((x) => x[1]);
  const s = new Set(idx);
  return a.map((r, i) => (s.has(i) ? 0 : r));
};
const bp = (x, d = 2) => (x * 1e4).toFixed(d);
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const f2 = (x) => x.toFixed(2);
const pad = (s, n) => String(s).padStart(n);
const padE = (s, n) => String(s).padEnd(n);
const net = (r, c) => ((1 - c) * (1 + r)) / (1 + c) - 1;

// --- dividend / split factor (dated note 1 in h6.md) -------------------------------------------

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
/**
 * L[i] = ln(adjusted daily open / 09:30 bar open) is a step function (the adjustment factor)
 * plus rare noise. Returns ex-date indices (first day of each new level) and per-day factor F.
 */
function adjustmentFactor(L) {
  const W = 10;
  const step = L.map((_, i) =>
    i < W || i > L.length - W ? 0 : median(L.slice(i, i + W)) - median(L.slice(i - W, i)),
  );
  const cand = [];
  for (let i = 0; i < L.length; i++) if (Math.abs(step[i]) > 5e-4) cand.push(i);
  // group candidates into clusters, pick the split that best separates the two levels
  const clusters = [];
  for (const i of cand) {
    const c = clusters.at(-1);
    if (c && i - c.at(-1) <= W) c.push(i);
    else clusters.push([i]);
  }
  const ex = [];
  for (const c of clusters) {
    const lo = Math.max(0, c[0] - W),
      hi = Math.min(L.length, c.at(-1) + W);
    let best = null;
    for (const i of c) {
      const before = median(L.slice(Math.max(lo, i - W), i));
      const after = median(L.slice(i, Math.min(hi, i + W)));
      let fit = 0;
      for (let j = lo; j < hi; j++) fit += Math.abs(L[j] - (j < i ? before : after)) < 1e-4 ? 1 : 0;
      if (!best || fit > best.fit) best = { i, fit, size: after - before };
    }
    ex.push(best);
  }
  const bounds = [0, ...ex.map((e) => e.i), L.length];
  const F = new Float64Array(L.length);
  const resid = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    const seg = L.slice(bounds[k], bounds[k + 1]);
    const m = median(seg);
    for (let j = bounds[k]; j < bounds[k + 1]; j++) {
      F[j] = Math.exp(m);
      resid.push(L[j] - m);
    }
  }
  return { ex, F, resid };
}

// --- build nights ------------------------------------------------------------------------------

const out = [];
const log = (...a) => out.push(a.join(' '));

const days = calendar.filter((d) => d.date >= FROM);
const data = {};

for (const T of TICKERS) {
  const daily = loadDaily(T);
  const sess = new Map();
  for (const d of calendar.filter((x) => x.date >= FROM)) {
    const s = sessionPrints(T, d);
    if (s && daily.get(d.date) && s.open) sess.set(d.date, s);
  }
  const sDates = [...sess.keys()].sort();
  // dated note 1 (derived factor from the 09:30 print), kept as a cross-check
  const L = sDates.map((d) => Math.log(daily.get(d).o / sess.get(d).open));
  const adj = adjustmentFactor(L);
  const Fd = new Map(sDates.map((d, i) => [d, adj.F[i]]));
  // dated note 2: official raw prices from data/daily-raw, F = adjusted close / raw close
  const rawDaily = loadDaily(T, 'daily-raw');
  const F = new Map();
  for (const d of sDates) {
    const s = sess.get(d);
    const r = rawDaily.get(d);
    s.offOpen = r.o;
    s.offClose = r.c;
    s.derOpen = daily.get(d).o / Fd.get(d);
    s.derClose = daily.get(d).c / Fd.get(d);
    F.set(d, daily.get(d).c / r.c);
  }
  // detected dividends (by calendar night, needs no minute data), then the imputation rule
  const divOn = new Map();
  for (let k = 1; k < calendar.length; k++) {
    const e = calendar[k].date,
      d = calendar[k - 1].date;
    if (e < FROM || !daily.get(e) || !daily.get(d) || !rawDaily.get(e) || !rawDaily.get(d)) continue;
    const fD = daily.get(d).c / rawDaily.get(d).c,
      fE = daily.get(e).c / rawDaily.get(e).c;
    const j = Math.log(fE / fD);
    if (j > EX_THRESHOLD && j < SPLIT_F) divOn.set(e, rawDaily.get(d).c * (1 - fD / fE));
  }
  const imputed = [];
  for (const date of IMPUTE[T] ?? []) {
    const ds = [...divOn.keys()].sort();
    const before = ds.filter((x) => x < date).at(-1);
    const after = ds.find((x) => x > date);
    const amts = [before, after].filter(Boolean).map((x) => divOn.get(x));
    imputed.push({ date, div: mean(amts), from: [before, after].filter(Boolean) });
  }
  const impMap = new Map(imputed.map((x) => [x.date, x.div]));
  const exSet = divOn;
  const rows = [];
  const skipped = { gap: [] };
  const flags = [];
  const exDates = [];
  const lateFills = { closeLate: 0, openLate: 0, closeLateMissing: 0, openLateMissing: 0 };
  for (const e of days) {
    const i = calIdx.get(e.date);
    const dDay = calendar[i - 1];
    if (e.date === FROM) continue; // first night needs 2015-12-31: dropped so all series share days
    const D = sess.get(dDay.date);
    const E = sess.get(e.date);
    if (!D || !E) {
      skipped.gap.push(e.date);
      continue;
    }
    const jump = Math.log(F.get(e.date) / F.get(dDay.date));
    let div = 0;
    if (Math.abs(jump) > SPLIT_F) flags.push(`${e.date} factor jump ${pct(jump, 2)}`);
    else if (jump < -EX_THRESHOLD) flags.push(`${e.date} negative factor step ${bp(jump)} bp`);
    else if (exSet.has(e.date)) {
      div = exSet.get(e.date);
      exDates.push({ date: e.date, div, yield: div / D.offClose });
    }
    const divImp = impMap.get(e.date) ?? 0;
    const onRaw = E.offOpen / D.offClose - 1;
    if (Math.abs(onRaw) > SPLIT_RAW) flags.push(`${e.date} raw overnight ${pct(onRaw)}`);
    const onNoImp = (E.offOpen + div) / D.offClose - 1;
    div += divImp;
    const on = (E.offOpen + div) / D.offClose - 1;
    const id = E.offClose / E.offOpen - 1;
    const cc = (1 + on) * (1 + id) - 1;
    // config 10: the same with minute prints (16:00 bar open, 09:30 bar open)
    const onMin = D.close ? (E.open + div) / D.close - 1 : null;
    const idMin = E.close ? E.close / E.open - 1 : null;
    // dated note 1 prices (derived factor), for the cross-check
    const onDer = (E.derOpen + div) / D.derClose - 1;
    const idDer = E.derClose / E.derOpen - 1;
    const ccOfficial = daily.get(e.date).c / daily.get(dDay.date).c - 1;
    const calGap = Math.round((Date.parse(e.date) - Date.parse(dDay.date)) / 86_400_000);
    // after-hours / residual / pre-market split
    let ah = null,
      resid = null,
      pm = null;
    if (D.ahLast && E.pmFirst) {
      ah = D.ahLast / D.offClose - 1;
      pm = E.offOpen / E.pmFirst - 1;
      resid = (1 + on) / ((1 + ah) * (1 + pm)) - 1;
    }
    // timing variants, on the raw scale: (1 + P) × (official close / entry) × (exit / official open)
    const entry = (p) => (p ? D.offClose / p : null);
    const exit = E.openLate ? E.openLate / E.offOpen : null;
    const v5 = D.pre1 ? (1 + on) * entry(D.pre1) - 1 : null;
    const v6 = D.closeLate ? (1 + on) * entry(D.closeLate) - 1 : null;
    const v7 = exit ? (1 + on) * exit - 1 : null;
    const v8 = D.closeLate && exit ? (1 + on) * entry(D.closeLate) * exit - 1 : null;
    if (D.closeLate && D.closeLateMin > 5) lateFills.closeLate++;
    if (!D.closeLate) lateFills.closeLateMissing++;
    if (E.openLate && E.openLateMin > 5) lateFills.openLate++;
    if (!E.openLate) lateFills.openLateMissing++;
    const hoursOn =
      (nyMidnight(e.date) + hhmm(e.open) * 60_000 - (nyMidnight(dDay.date) + hhmm(dDay.close) * 60_000)) /
      3.6e6;
    const hoursId = (hhmm(e.close) - hhmm(e.open)) / 60;
    rows.push({
      date: e.date,
      year: Number(e.date.slice(0, 4)),
      on,
      onRaw,
      onNoImp,
      onMin,
      idMin,
      onDer,
      idDer,
      id,
      cc,
      ccOfficial,
      div,
      weekend: calGap > 1,
      ah,
      resid,
      pm,
      v5,
      v6,
      v7,
      v8,
      rf: bilRet.get(e.date) ?? 0,
      hoursOn,
      hoursId,
    });
  }
  data[T] = { rows, skipped, flags, exDates, imputed, lateFills, sess, daily, F, adj, sDates };
}

// --- 0. verification ---------------------------------------------------------------------------

const q = (a, p) => {
  const s = a.map(Math.abs).sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
const distLine = (a) =>
  `median ${bp(q(a, 0.5))} bp, 90th ${bp(q(a, 0.9))}, 99th ${bp(q(a, 0.99))}, within 0.4 bp on ${pct(a.filter((x) => Math.abs(x) < 4e-5).length / a.length, 0)}`;

log('# H6 overnight drift — output of research/tools/h6-overnight.mjs\n');
log('## 0. Data verification\n');
log(
  'Prices: official open/close from data/daily-raw; dividend factor F = adjusted close (data/daily) / raw close; ex-date where ln F steps up by > 2 bp (h6.md, dated note 2).\n',
);
for (const T of TICKERS) {
  const { rows, skipped, flags, exDates, imputed, sess, daily, F, sDates } = data[T];
  log(`### ${T}`);
  const gap = (a, b) =>
    sDates.filter((d) => sess.get(d)[b]).map((d) => Math.log(sess.get(d)[a] / sess.get(d)[b]));
  log(`- Opening: |ln(official open / 09:30 bar open)|: ${distLine(gap('offOpen', 'open'))}.`);
  log(`- Closing: |ln(official close / 16:00 bar open)|: ${distLine(gap('offClose', 'close'))}.`);
  log(`- Closing: |ln(official close / 15:59 bar open)|: ${distLine(gap('offClose', 'pre1'))}.`);
  const big = (a) => a.filter((x) => Math.abs(x) > 5e-4).length;
  log(
    `- Days with the minute print > 5 bp from the official price: 09:30 open ${big(gap('offOpen', 'open'))}, 16:00 bar open ${big(gap('offClose', 'close'))} (of ${sDates.length}).`,
  );
  log(
    `- Dated-note-1 derived prices vs data/daily-raw: open ${distLine(gap('derOpen', 'offOpen'))}; close ${distLine(gap('derClose', 'offClose'))}.`,
  );
  // cent-level check on the days after the last ex-date
  const lastEx = exDates.at(-1)?.date ?? FROM;
  const tail = sDates.filter((d) => d >= lastEx);
  const eqO = tail.filter((d) => Math.abs(daily.get(d).o - sess.get(d).open) < 0.005).length;
  const eqC = tail.filter((d) => Math.abs(daily.get(d).c - (sess.get(d).close ?? NaN)) < 0.005).length;
  log(
    `- Since the last ex-date (${lastEx}, ${tail.length} days, F = ${F.get(tail.at(-1)).toFixed(6)}): daily open = 09:30 bar open to the cent on ${eqO}; daily close = 16:00 bar open on ${eqC}.`,
  );
  const recon = rows.map((r) => r.cc - r.ccOfficial);
  log(
    `- Reconstructed close-to-close vs official adjusted close-to-close: ${distLine(recon)}, max ${bp(q(recon, 1))} bp.`,
  );
  const byY = {};
  for (const x of exDates) (byY[x.date.slice(0, 4)] ??= []).push(x);
  log(
    `- Ex-dividend nights: ${exDates.length}. Per year: ${Object.entries(byY)
      .map(([y, a]) => `${y} ${a.length}`)
      .join(', ')}. Total dividend yield ${pct(exDates.reduce((s, x) => s + x.yield, 0), 1)} over the sample.`,
  );
  log(`  - ${exDates.map((x) => `${x.date} $${x.div.toFixed(3)}`).join(', ')}`);
  log(
    `- Imputed dividends (missing from the adjusted bars): ${
      imputed.length
        ? imputed.map((x) => `${x.date} $${x.div.toFixed(3)} (mean of ${x.from.join(' & ')})`).join('; ')
        : 'none'
    }`,
  );
  log(`- Split / anomaly flags: ${flags.length ? flags.join('; ') : 'none'}`);
  log(
    `- Nights used: ${rows.length}. Skipped (minute file missing on D or E): ${skipped.gap.length}: ${skipped.gap.join(', ')}`,
  );
  log('');
}


// --- 1. decomposition --------------------------------------------------------------------------

function decompLine(label, a, cc) {
  return `| ${padE(label, 22)} | ${pad(bp(mean(a)), 6)} | ${pad(pct(mean(a) * 252), 6)} | ${pad(f2(tstat(a)), 5)} | ${pad(f2(nwT(a)), 5)} | ${pad(bp(sd(a), 1), 6)} | ${pad(cc ? pct(mean(a) / mean(cc), 0) : '', 5)} | ${pad(bp(Math.min(...a), 0), 6)} | ${pad(bp(mean(dropBest(a))), 6)} |`;
}
log('## 1. Decomposition, no costs (common days; overnight includes the dividend)\n');
const verdictInputs = {};
for (const T of TICKERS) {
  const R = data[T].rows;
  const on = R.map((r) => r.on),
    onRaw = R.map((r) => r.onRaw),
    id = R.map((r) => r.id),
    cc = R.map((r) => r.cc),
    diff = R.map((r) => r.on - r.id);
  log(`### ${T} (${R.length} days, ${R[0].date} → ${R.at(-1).date})\n`);
  log('| Series                 | bp/day | ann.   | t     | NW t  | sd bp  | share | worst  | −5best |');
  log('| ---------------------- | ------ | ------ | ----- | ----- | ------ | ----- | ------ | ------ |');
  log(decompLine('overnight (total)', on, cc));
  log(decompLine('overnight (raw, no div)', onRaw, cc));
  log(decompLine('intraday', id, cc));
  log(decompLine('close-to-close', cc, cc));
  log(decompLine('overnight − intraday', diff, null));
  const lon = on.reduce((s, r) => s + Math.log(1 + r), 0);
  const lid = id.reduce((s, r) => s + Math.log(1 + r), 0);
  log(
    `\nLog-return share (information): overnight ${pct(lon / (lon + lid), 0)}, intraday ${pct(lid / (lon + lid), 0)}. Growth of $1: overnight ${growth(on).toFixed(2)}, intraday ${growth(id).toFixed(2)}, buy-and-hold ${growth(cc).toFixed(2)}.\n`,
  );
  log('| Year | n   | overnight bp | intraday bp | cc bp | on − id bp | t(on) | t(diff) | on share |');
  log('| ---- | --- | ------------ | ----------- | ----- | ---------- | ----- | ------- | -------- |');
  const years = [...new Set(R.map((r) => r.year))];
  let posYears = 0;
  for (const y of years) {
    const Y = R.filter((r) => r.year === y);
    const o = Y.map((r) => r.on),
      i = Y.map((r) => r.id),
      c = Y.map((r) => r.cc),
      d = Y.map((r) => r.on - r.id);
    if (FULL_YEARS.includes(y) && mean(o) > 0) posYears++;
    log(
      `| ${y}${FULL_YEARS.includes(y) ? ' ' : '*'}| ${pad(Y.length, 3)} | ${pad(bp(mean(o)), 12)} | ${pad(bp(mean(i)), 11)} | ${pad(bp(mean(c)), 5)} | ${pad(bp(mean(d)), 10)} | ${pad(f2(tstat(o)), 5)} | ${pad(f2(tstat(d)), 7)} | ${pad(pct(mean(o) / mean(c), 0), 8)} |`,
    );
  }
  log(`\n(* partial year, not counted.) Full years with mean overnight > 0: ${posYears} of 10.\n`);
  verdictInputs[T] = { mOn: mean(on), tOn: tstat(on), mDiff: mean(diff), tDiff: tstat(diff), posYears };
}

// --- verdict: effect exists --------------------------------------------------------------------

const S = verdictInputs.SPY;
const c1 = S.mOn > 0 && S.tOn >= 2.5;
const c2 = S.mDiff > 0 && S.tDiff >= 2;
const c3 = ['QQQ', 'IWM'].every((t) => verdictInputs[t].mOn > 0 && verdictInputs[t].mDiff > 0);
const c4 = S.posYears >= 7;
log('### Pass rule: "the effect exists"\n');
log(`1. SPY overnight mean ${bp(S.mOn)} bp, t ${f2(S.tOn)} (need > 0, t ≥ 2.5): ${c1 ? 'PASS' : 'FAIL'}`);
log(`2. SPY overnight − intraday ${bp(S.mDiff)} bp, t ${f2(S.tDiff)} (need > 0, t ≥ 2): ${c2 ? 'PASS' : 'FAIL'}`);
log(
  `3. QQQ overnight ${bp(verdictInputs.QQQ.mOn)} bp, diff ${bp(verdictInputs.QQQ.mDiff)} bp; IWM overnight ${bp(verdictInputs.IWM.mOn)} bp, diff ${bp(verdictInputs.IWM.mDiff)} bp (need all > 0): ${c3 ? 'PASS' : 'FAIL'}`,
);
log(`4. SPY overnight positive in ${S.posYears} of 10 full years (need ≥ 7): ${c4 ? 'PASS' : 'FAIL'}`);
const inconclusive =
  !c1 || !c2
    ? S.mOn > 0 && S.mDiff > 0 && c3 && c4 && S.tOn >= 1.5 && S.tDiff >= 1
    : false;
log(`\n**Effect exists: ${c1 && c2 && c3 && c4 ? 'PASS' : inconclusive ? 'INCONCLUSIVE' : 'FAIL'}**\n`);

// --- 2. strategies -----------------------------------------------------------------------------

/** Strategy series: for each row, the leg return (or null = no trade that day). */
function strat(rows, leg, c, { cashEarnsRf = false } = {}) {
  const r = rows.map((x) => (x[leg] == null ? 0 : net(x[leg], c)));
  const ex = rows.map((x, i) => (cashEarnsRf ? r[i] : r[i] - x.rf));
  return { r, ex };
}
function stratStats(r, ex, nDays) {
  return {
    cagr: cagr(r, nDays),
    vol: sd(r) * Math.sqrt(252),
    sharpe: sharpe(ex),
    t: tstat(ex),
    mdd: maxDD(r),
    worst: Math.min(...r),
    cagr5: cagr(dropBest(r), nDays),
  };
}
const statsLine = (label, s, tim) =>
  `| ${padE(label, 30)} | ${pad(pct(s.cagr), 6)} | ${pad(pct(s.vol), 6)} | ${pad(f2(s.sharpe), 6)} | ${pad(f2(s.t), 5)} | ${pad(pct(s.mdd), 7)} | ${pad(pct(s.worst), 6)} | ${pad(pct(s.cagr5), 7)} | ${pad(tim, 13)} |`;

function bisect(fn, lo = 0, hi = 0.005) {
  if (fn(lo) <= 0) return 0;
  if (fn(hi) > 0) return Infinity;
  for (let k = 0; k < 60; k++) {
    const m = (lo + hi) / 2;
    if (fn(m) > 0) lo = m;
    else hi = m;
  }
  return lo;
}

log('## 2. Strategies (each-way cost per side; Sharpe on excess of BIL)\n');
log(
  'Overnight-only and buy-and-hold are invested at every end of day, so excess = return − BIL. Intraday-only is in cash at every end of day, so it earns BIL and its excess is its return. CAGR uses 252 days a year. Skipped days are 0 for the strategies and excluded for buy-and-hold.\n',
);
const tradeVerdict = {};
for (const T of TICKERS) {
  const R = data[T].rows;
  const n = R.length;
  const totalHours = R.reduce((s, r) => s + r.hoursOn + r.hoursId, 0);
  const onHours = R.reduce((s, r) => s + r.hoursOn, 0) / totalHours;
  const idHours = R.reduce((s, r) => s + r.hoursId, 0) / totalHours;
  const bh = strat(R, 'cc', 0);
  const bhS = stratStats(bh.r, bh.ex, n);
  log(`### ${T}\n`);
  log('| Strategy                       | CAGR   | vol    | Sharpe | t     | maxDD   | worst  | −5 best | time in mkt   |');
  log('| ------------------------------ | ------ | ------ | ------ | ----- | ------- | ------ | ------- | ------------- |');
  log(statsLine('buy-and-hold', bhS, '100% / 100%'));
  const res = {};
  for (const [cn, c] of Object.entries(COSTS)) {
    const o = strat(R, 'on', c);
    res[cn] = stratStats(o.r, o.ex, n);
    log(statsLine(`overnight-only, ${cn} ${Math.round(c * 1e4)} bp`, res[cn], `${pct(onHours, 0)} / 0%`));
  }
  for (const [cn, c] of Object.entries(COSTS)) {
    const o = strat(R, 'id', c, { cashEarnsRf: true });
    log(statsLine(`intraday-only, ${cn} ${Math.round(c * 1e4)} bp`, stratStats(o.r, o.ex, n), `${pct(idHours, 0)} / 100%`));
  }
  log('\n(time in market = share of clock hours / share of regular-session hours)\n');
  // break-evens
  const onArr = R.map((r) => r.on);
  const be0 = bisect((c) => mean(onArr.map((r) => net(r, c))));
  const beRf = bisect((c) => mean(R.map((r) => net(r.on, c) - r.rf)));
  const beBh = bisect((c) => {
    const o = strat(R, 'on', c);
    return sharpe(o.ex) - bhS.sharpe;
  });
  log(
    `Break-even each-way cost for overnight-only: mean return 0 at ${bp(be0)} bp per side; excess over BIL 0 at ${bp(beRf)} bp; Sharpe equal to buy-and-hold's (${f2(bhS.sharpe)}) ${beBh === 0 ? 'never (its zero-cost Sharpe is already lower)' : `at ${bp(beBh)} bp`}.`,
  );
  // by year, overnight at primary vs buy-and-hold
  const years = [...new Set(R.map((r) => r.year))];
  log('\n| Year | B&H return | overnight 0 bp | overnight 1 bp | overnight 3 bp | intraday 0 bp |');
  log('| ---- | ---------- | -------------- | -------------- | -------------- | ------------- |');
  for (const y of years) {
    const Y = R.filter((r) => r.year === y);
    const g = (leg, c) => growth(Y.map((r) => (r[leg] == null ? 0 : net(r[leg], c)))) - 1;
    log(
      `| ${y} | ${pad(pct(g('cc', 0)), 10)} | ${pad(pct(g('on', 0)), 14)} | ${pad(pct(g('on', 1e-4)), 14)} | ${pad(pct(g('on', 3e-4)), 14)} | ${pad(pct(g('id', 0)), 13)} |`,
    );
  }
  log('');
  tradeVerdict[T] = { primary: res.primary.sharpe, bh: bhS.sharpe, be0, beRf, beBh };
}
const tv = tradeVerdict.SPY;
log('### Pass rule: "worth trading"\n');
log(
  `SPY overnight-only Sharpe at primary 1 bp ${f2(tv.primary)} vs buy-and-hold ${f2(tv.bh)}: **${tv.primary > tv.bh ? 'PASS' : 'FAIL'}**. (QQQ ${f2(tradeVerdict.QQQ.primary)} vs ${f2(tradeVerdict.QQQ.bh)}, IWM ${f2(tradeVerdict.IWM.primary)} vs ${f2(tradeVerdict.IWM.bh)}, information.)\n`,
);

// --- 3. information-only grid ------------------------------------------------------------------

log('## 3. Information only\n');
log('### 3a. Weekend/holiday nights vs single weeknights (overnight total, no costs)\n');
log('| Ticker | weeknights n | bp/night | t    | weekend n | bp/night | t    | weekend bp per calendar day |');
log('| ------ | ------------ | -------- | ---- | --------- | -------- | ---- | --------------------------- |');
for (const T of TICKERS) {
  const R = data[T].rows;
  const wk = R.filter((r) => !r.weekend).map((r) => r.on);
  const we = R.filter((r) => r.weekend).map((r) => r.on);
  const weDays = mean(
    R.filter((r) => r.weekend).map((r) => {
      const i = calIdx.get(r.date);
      return Math.round((Date.parse(r.date) - Date.parse(calendar[i - 1].date)) / 86_400_000);
    }),
  );
  log(
    `| ${T}    | ${pad(wk.length, 12)} | ${pad(bp(mean(wk)), 8)} | ${pad(f2(tstat(wk)), 4)} | ${pad(we.length, 9)} | ${pad(bp(mean(we)), 8)} | ${pad(f2(tstat(we)), 4)} | ${pad(bp(mean(we) / weDays), 27)} |`,
  );
  const wkI = R.filter((r) => !r.weekend).map((r) => r.id);
  const weI = R.filter((r) => r.weekend).map((r) => r.id);
  log(
    `|        | (intraday after weeknight ${bp(mean(wkI))} bp, after weekend ${bp(mean(weI))} bp)`,
  );
}
log('\n### 3b. Overnight split: after-hours, 20:00 → 04:00 residual (incl. dividend), pre-market (no costs)\n');
log('| Ticker | n    | after-hours bp | t     | residual bp | t     | pre-market bp | t     | sum bp | sd AH / res / PM bp |');
log('| ------ | ---- | -------------- | ----- | ----------- | ----- | ------------- | ----- | ------ | ------------------- |');
for (const T of TICKERS) {
  const R = data[T].rows.filter((r) => r.ah != null);
  const a = R.map((r) => r.ah),
    b = R.map((r) => r.resid),
    c = R.map((r) => r.pm);
  log(
    `| ${T}    | ${pad(R.length, 4)} | ${pad(bp(mean(a)), 14)} | ${pad(f2(tstat(a)), 5)} | ${pad(bp(mean(b)), 11)} | ${pad(f2(tstat(b)), 5)} | ${pad(bp(mean(c)), 13)} | ${pad(f2(tstat(c)), 5)} | ${pad(bp(mean(a) + mean(b) + mean(c)), 6)} | ${bp(sd(a), 0)} / ${bp(sd(b), 0)} / ${bp(sd(c), 0)} |`,
  );
}
log('\nBy year, SPY (bp/night):\n');
log('| Year | after-hours | residual | pre-market | intraday |');
log('| ---- | ----------- | -------- | ---------- | -------- |');
{
  const R = data.SPY.rows.filter((r) => r.ah != null);
  for (const y of [...new Set(R.map((r) => r.year))]) {
    const Y = R.filter((r) => r.year === y);
    log(
      `| ${y} | ${pad(bp(mean(Y.map((r) => r.ah))), 11)} | ${pad(bp(mean(Y.map((r) => r.resid))), 8)} | ${pad(bp(mean(Y.map((r) => r.pm))), 10)} | ${pad(bp(mean(Y.map((r) => r.id))), 8)} |`,
    );
  }
}

log('\n### 3c. Timing variants of the overnight trade (configs 5–8)\n');
log('| Ticker | Variant                       | n    | gross bp | t     | Sharpe 0 | Sharpe 1 bp | Sharpe 3 bp | CAGR 1 bp | break-even bp |');
log('| ------ | ----------------------------- | ---- | -------- | ----- | -------- | ----------- | ----------- | --------- | ------------- |');
const variants = [
  ['on', 'P: 16:00 auction → 09:30'],
  ['onRaw', '2: P without dividend'],
  ['v5', '5: 15:59 open → 09:30'],
  ['v6', '6: 16:01+ → 09:30'],
  ['v7', '7: 16:00 auction → 09:31+'],
  ['v8', '8: 16:01+ → 09:31+'],
];
for (const T of TICKERS) {
  const R = data[T].rows;
  for (const [leg, label] of variants) {
    const used = R.filter((r) => r[leg] != null);
    const g = used.map((r) => r[leg]);
    const sh = (c) => sharpe(strat(R, leg, c).ex);
    const be = bisect((c) => mean(g.map((r) => net(r, c))));
    log(
      `| ${T}    | ${padE(label, 29)} | ${pad(used.length, 4)} | ${pad(bp(mean(g)), 8)} | ${pad(f2(tstat(g)), 5)} | ${pad(f2(sh(0)), 8)} | ${pad(f2(sh(1e-4)), 11)} | ${pad(f2(sh(3e-4)), 11)} | ${pad(pct(cagr(strat(R, leg, 1e-4).r)), 9)} | ${pad(bp(be), 13)} |`,
    );
  }
  const lf = data[T].lateFills;
  log(
    `|        | late fills > 5 min: 16:01 entry ${lf.closeLate}, 09:31 exit ${lf.openLate}; no print 16:01–20:00 ${lf.closeLateMissing} |`,
  );
}

log('\n### 3d. Return per unit of variance (daily mean / daily variance; no costs)\n');
log('| Ticker | overnight mean/var | intraday mean/var | cc mean/var | var share overnight | sd on / id / cc bp |');
log('| ------ | ------------------ | ----------------- | ----------- | ------------------- | ------------------ |');
for (const T of TICKERS) {
  const R = data[T].rows;
  const on = R.map((r) => r.on),
    id = R.map((r) => r.id),
    cc = R.map((r) => r.cc);
  const v = (a) => sd(a) ** 2;
  log(
    `| ${T}    | ${pad(f2(mean(on) / v(on)), 18)} | ${pad(f2(mean(id) / v(id)), 17)} | ${pad(f2(mean(cc) / v(cc)), 11)} | ${pad(pct(v(on) / (v(on) + v(id)), 0), 19)} | ${bp(sd(on), 0)} / ${bp(sd(id), 0)} / ${bp(sd(cc), 0)} |`,
  );
}
log(
  '\n(If overnight return were compensation for overnight variance at the same price of risk as intraday, the two mean/var ratios would be equal.)',
);

log('\n### 3e. Price-source sensitivity (config 10, dated note 2; no costs)\n');
log('| Ticker | Prices                                   | n    | overnight bp (t) | intraday bp (t) | on − id bp (t) | on share |');
log('| ------ | ---------------------------------------- | ---- | ---------------- | --------------- | -------------- | -------- |');
for (const T of TICKERS) {
  const sets = [
    ['official, data/daily-raw (primary)', 'on', 'id'],
    ['official, without imputed dividends', 'onNoImp', 'id'],
    ['dated note 1 (derived from adjusted)', 'onDer', 'idDer'],
    ['minute prints: 16:00 bar open, 09:30 open', 'onMin', 'idMin'],
  ];
  for (const [label, a, b] of sets) {
    const R = data[T].rows.filter((r) => r[a] != null && r[b] != null);
    const o = R.map((r) => r[a]),
      i = R.map((r) => r[b]),
      d = R.map((r) => r[a] - r[b]);
    log(
      `| ${T}    | ${padE(label, 40)} | ${pad(R.length, 4)} | ${pad(`${bp(mean(o))} (${f2(tstat(o))})`, 16)} | ${pad(`${bp(mean(i))} (${f2(tstat(i))})`, 15)} | ${pad(`${bp(mean(d))} (${f2(tstat(d))})`, 14)} | ${pad(pct(mean(o) / (mean(o) + mean(i)), 0), 8)} |`,
    );
  }
}

console.log(out.join('\n'));
