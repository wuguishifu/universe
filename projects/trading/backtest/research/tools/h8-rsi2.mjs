// H8: Connors RSI(2) short-term reversal, as pre-registered in research/hypotheses/h8.md.
// usage: node research/tools/h8-rsi2.mjs [--check] [data dir]
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const dataDir = args.find((a) => !a.startsWith('--')) ?? 'data';

const FIRST_ENTRY = '2017-01-03';
const END = '2026-11-13';
const MINUTE_TICKERS = ['SPY', 'QQQ', 'IWM'];
const DAILY_ONLY = ['EFA', 'XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY'];
const DIV_MIN = 0.0005; // 5 bp
const COSTS = { zero: 0, primary: 0.0001, stress: 0.0003 };
const BOOT = 10_000;

// --- helpers ------------------------------------------------------------------------------------
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const tstat = (xs) => (mean(xs) / sdev(xs)) * Math.sqrt(xs.length);
const welch = (a, b) => {
  const va = sdev(a) ** 2 / a.length;
  const vb = sdev(b) ** 2 / b.length;
  return (mean(a) - mean(b)) / Math.sqrt(va + vb);
};
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

// --- data ---------------------------------------------------------------------------------------
const loadDaily = (t) =>
  JSON.parse(readFileSync(`${dataDir}/daily/${t}.json`, 'utf8')).map((b) => ({
    date: b.t.slice(0, 10),
    o: b.o,
    c: b.c,
  }));
const bil = loadDaily('BIL');
const dates = bil.map((b) => b.date).filter((d) => d <= END);
const idx = new Map(dates.map((d, i) => [d, i]));
const START = idx.get(FIRST_ENTRY);
const LAST = dates.length - 1;
if (START === undefined || dates[LAST] !== END) throw new Error('window dates');
const bilC = dates.map((d, i) => bil[i].c);
const bilRet = bilC.map((c, i) => (i === 0 ? NaN : c / bilC[i - 1] - 1));

const calendar = new Map(
  JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).map((d) => [d.date, d]),
);
const hm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const nyFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  hourCycle: 'h23',
});
const utcOffsetMin = (d) => (Number(nyFmt.format(new Date(`${d}T12:00:00Z`))) - 12) * 60;

/** Raw minute prices for one day: first regular bar's open, closing-bar open, decision prices k minutes before the close. */
function minuteDay(t, d, offsets) {
  const file = `${dataDir}/stocks/${t}/${d}.json`;
  const cal = calendar.get(d);
  if (!cal || !existsSync(file)) return null;
  const off = utcOffsetMin(d);
  const close = hm(cal.close);
  const open = hm(cal.open);
  const bars = JSON.parse(readFileSync(file, 'utf8')).map((b) => {
    const u = new Date(b.t);
    return { m: u.getUTCHours() * 60 + u.getUTCMinutes() + off, o: b.o, c: b.c };
  });
  if (!bars.length) return null;
  const first = bars.find((b) => b.m === open);
  const closing = bars.find((b) => b.m === close);
  const dec = {};
  const exact = {};
  for (const k of offsets) {
    const D = close - k; // decision time; price = close of the bar starting at D-1
    let best = null;
    for (const b of bars) if (b.m >= Math.max(open, D - 15) && b.m <= D - 1 && (!best || b.m > best.m)) best = b;
    dec[k] = best ? best.c : null;
    exact[k] = !!best && best.m === D - 1;
  }
  return { m0930: first ? first.o : null, m1600: closing ? closing.o : null, dec, exact };
}

function loadTicker(t) {
  const rows = new Map(loadDaily(t).map((b) => [b.date, b]));
  const bars = dates.map((d) => {
    const b = rows.get(d);
    if (b === undefined) throw new Error(`${t} missing ${d}`);
    return b;
  });
  const C = bars.map((b) => b.c);
  const O = bars.map((b) => b.o);
  const ret = C.map((c, i) => (i === 0 ? NaN : c / C[i - 1] - 1));
  const out = { t, C, ret, X: { close: C } };
  if (!MINUTE_TICKERS.includes(t)) return out;
  const md = dates.map((d) => minuteDay(t, d, [5, 10]));
  // split/dividend factor, known at 09:30; a change of more than 1% (no ex-date of these ETFs is that
  // large) is a bad opening print, so the previous day's factor is used (dated note 1)
  const rawFactor = md.map((m, i) => (m?.m0930 ? O[i] / m.m0930 : null));
  let guarded = 0;
  let lastGood = null;
  const factor = rawFactor.map((f, i) => {
    if (f && lastGood && Math.abs(f / lastGood - 1) > 0.01) {
      if (i >= START) guarded++;
      return lastGood;
    }
    if (f) lastGood = f;
    return f;
  });
  out.guarded = guarded;
  const fallbacks = {};
  const inexact = {};
  for (const k of [5, 10]) {
    let fb = 0;
    let ix = 0;
    out.X[k] = C.map((c, i) => {
      const p = md[i]?.dec[k];
      if (!p || !factor[i]) {
        if (i >= START) fb++;
        return c;
      }
      if (i >= START && !md[i].exact[k]) ix++;
      return p * factor[i];
    });
    fallbacks[k] = fb;
    inexact[k] = ix;
  }
  Object.assign(out, { factor, fallbacks, inexact, md, O });
  return out;
}

// --- data check ---------------------------------------------------------------------------------
if (CHECK) {
  for (const t of MINUTE_TICKERS) {
    const s = loadTicker(t);
    const jumps = {};
    const small = [];
    let n = 0;
    for (let i = 1; i < dates.length; i++) {
      const a = s.factor[i];
      const b = s.factor[i - 1];
      if (!a || !b) continue;
      n++;
      const r = b / a - 1; // > 0 on an ex-date: earlier days carry an extra dividend factor
      if (Math.abs(r) > DIV_MIN) (jumps[dates[i].slice(0, 4)] ??= []).push(`${dates[i].slice(5)} ${bp(r, 0)}`);
      else small.push(Math.abs(r));
    }
    small.sort((x, y) => x - y);
    const q = (p) => bp(small[Math.floor(p * (small.length - 1))], 2);
    const noFirst = s.factor.filter((f, i) => i >= START && !f).length;
    // 16:00 open vs official close, as a ratio to the open-based factor (information)
    const gap = [];
    for (let i = START; i <= LAST; i++) if (s.factor[i] && s.md[i]?.m1600) gap.push(Math.log(s.C[i] / (s.md[i].m1600 * s.factor[i])));
    const ag = gap.map(Math.abs).sort((x, y) => x - y);
    const gq = (p) => bp(ag[Math.floor(p * (ag.length - 1))], 2);
    const dc = [];
    for (let i = START; i <= LAST; i++) if (s.X[5][i] !== s.C[i]) dc.push(Math.log(s.X[5][i] / s.C[i]));
    console.log(`\n${t}: ${n} consecutive-day factor pairs. Non-jump |change|: median ${q(0.5)} bp, 99th pct ${q(0.99)} bp, max ${q(1)} bp`);
    console.log(`  window days without a 09:30 bar: ${noFirst}; factor guard used: ${s.guarded}; decision fallbacks to C_t: 15:55 ${s.fallbacks[5]}, 15:50 ${s.fallbacks[10]}; decision bar not the exact minute: 15:55 ${s.inexact[5]}, 15:50 ${s.inexact[10]}`);
    console.log(`  |official close vs 16:00 open| (bp): median ${gq(0.5)}, 90th ${gq(0.9)}, 99th ${gq(0.99)}, max ${gq(1)} (n ${ag.length})`);
    console.log(`  15:55 price vs official close: sd ${bp(sdev(dc), 1)} bp, n ${dc.length}`);
    console.log('  factor jumps > 5 bp (ex-dates; bp):');
    for (const [y, v] of Object.entries(jumps)) console.log(`    ${y} (${v.length}): ${v.join(', ')}`);
  }
  process.exit(0);
}

// --- strategy -----------------------------------------------------------------------------------
/** Wilder (α = 1/2) or Cutler (2-day simple) RSI state from closes; returns RSI at day i using X. */
function makeRSI(C, kind) {
  const n = C.length;
  const aU = new Array(n).fill(NaN);
  const aD = new Array(n).fill(NaN);
  const U = (i, p) => Math.max(p - C[i - 1], 0);
  const D = (i, p) => Math.max(C[i - 1] - p, 0);
  aU[2] = (U(1, C[1]) + U(2, C[2])) / 2;
  aD[2] = (D(1, C[1]) + D(2, C[2])) / 2;
  for (let i = 3; i < n; i++) {
    aU[i] = (aU[i - 1] + U(i, C[i])) / 2;
    aD[i] = (aD[i - 1] + D(i, C[i])) / 2;
  }
  const rsi = (u, d) => (u + d === 0 ? 50 : d === 0 ? 100 : 100 - 100 / (1 + u / d));
  if (kind === 'cutler')
    return (i, p) => rsi((U(i - 1, C[i - 1]) + U(i, p)) / 2, (D(i - 1, C[i - 1]) + D(i, p)) / 2);
  return (i, p) => rsi((aU[i - 1] + U(i, p)) / 2, (aD[i - 1] + D(i, p)) / 2);
}
const prefix = (C) => {
  const p = [0];
  for (const c of C) p.push(p.at(-1) + c);
  return p;
};

function runRule(s, cfg) {
  const { thr = 10, exit = 'sma5', filter = true, delay = 0, rsi = 'wilder', dec = 5 } = cfg;
  const C = s.C;
  const X = dec === 'close' ? s.X.close : s.X[dec];
  if (!X) throw new Error(`${s.t} has no decision series ${dec}`);
  const R = makeRSI(C, rsi);
  const P = prefix(C);
  const sma = (i, n, x) => (P[i] - P[i - n + 1] + x) / n; // C[i-n+1..i-1] and x
  const trades = [];
  let pos = null;
  let pending = false;
  for (let i = START; i <= LAST; i++) {
    const x = X[i];
    if (pos !== null) {
      if (i > pos) {
        const out = exit === 'sma5' ? x > sma(i, 5, x) : R(i, x) > 70;
        if (out || i === LAST) {
          trades.push({ e: pos, x: i, open: !out });
          pos = null;
        }
      }
      continue;
    }
    if (pending) {
      pending = false;
      if (i < LAST) pos = i;
      continue;
    }
    const sig = R(i, x) < thr && (!filter || x > sma(i, 200, x));
    if (sig && i < LAST) {
      if (delay === 0) pos = i;
      else pending = true;
    }
  }
  return trades;
}

/** Daily return series over window days START+1..LAST at cost c per side. */
function evaluate(s, trades, c) {
  const n = LAST - START;
  const r = new Array(n);
  const inMkt = new Array(n).fill(false);
  for (let i = START + 1; i <= LAST; i++) r[i - START - 1] = bilRet[i];
  const tr = [];
  for (const { e, x } of trades) {
    let g = 1;
    for (let i = e + 1; i <= x; i++) {
      let v = 1 + s.ret[i];
      g *= v;
      if (i === e + 1) v *= 1 - c;
      if (i === x) v *= 1 - c;
      r[i - START - 1] = v - 1;
      inMkt[i - START - 1] = true;
    }
    tr.push({ e, x, h: x - e, gross: g - 1, net: g * (1 - c) ** 2 - 1, year: dates[x].slice(0, 4) });
  }
  return { r, inMkt, tr };
}

function stats(s, trades, c) {
  const { r, inMkt, tr } = evaluate(s, trades, c);
  const bilW = bilRet.slice(START + 1);
  const all = s.ret.slice(START + 1);
  const ex = r.map((v, k) => v - bilW[k]);
  const inR = r.filter((_, k) => inMkt[k]);
  const outAll = all.filter((_, k) => !inMkt[k]);
  const nets = tr.map((t) => t.net);
  const tim = inR.length / r.length;
  const bySorted = [...nets].sort((a, b) => b - a).slice(5);
  const top5days = new Set(
    r.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]).slice(0, 5).map(([, k]) => k),
  );
  const rNo5 = r.filter((_, k) => !top5days.has(k));
  const exNo5 = ex.filter((_, k) => !top5days.has(k));
  const years = {};
  for (let k = 0; k < r.length; k++) {
    const y = dates[START + 1 + k].slice(0, 4);
    const Y = (years[y] ??= { inR: [], all: [], n: 0, sum: 0, r: [] });
    Y.all.push(all[k]);
    Y.r.push(r[k]);
    if (inMkt[k]) Y.inR.push(r[k]);
  }
  for (const t of tr) {
    years[t.year].n++;
    years[t.year].sum += t.net;
  }
  return {
    n: tr.length,
    hold: mean(tr.map((t) => t.h)),
    hit: tr.filter((t) => t.net > 0).length / (tr.length || 1),
    meanTrade: mean(nets),
    medTrade: [...nets].sort((a, b) => a - b)[Math.floor(nets.length / 2)],
    worstTrade: Math.min(...nets),
    tTrade: tstat(nets),
    meanNo5: mean(bySorted),
    tNo5: tstat(bySorted),
    cagr: cagr(r),
    vol: sdev(r) * Math.sqrt(252),
    sharpe: (mean(ex) / sdev(ex)) * Math.sqrt(252),
    tEx: tstat(ex),
    dd: maxDD(r),
    worstDay: Math.min(...r),
    tim,
    perDayIn: mean(inR),
    perDayAll: mean(all),
    gap: mean(inR) - mean(all),
    tGap: welch(inR, all),
    gapOut: mean(inR) - mean(outAll),
    tGapOut: welch(inR, outAll),
    cagrNo5: cagr(rNo5),
    tExNo5: tstat(exNo5),
    years,
    tr,
    r,
  };
}

function benchmarks(s, tim) {
  const all = s.ret.slice(START + 1);
  const bilW = bilRet.slice(START + 1);
  const mix = all.map((v, k) => tim * v + (1 - tim) * bilW[k]);
  const sh = (rs) => {
    const ex = rs.map((v, k) => v - bilW[k]);
    return (mean(ex) / sdev(ex)) * Math.sqrt(252);
  };
  return {
    bh: { cagr: cagr(all), sharpe: sh(all), dd: maxDD(all), worstDay: Math.min(...all), vol: sdev(all) * Math.sqrt(252) },
    mix: { cagr: cagr(mix), sharpe: sh(mix), dd: maxDD(mix) },
  };
}

/** Random-entry bootstrap of the mean gross trade, same number and lengths of holds. */
function bootstrap(s, trades, filtered, seed) {
  const rnd = mulberry32(seed);
  const C = s.C;
  const P = prefix(C);
  const ok = [];
  for (let i = START; i < LAST; i++) {
    if (!filtered) ok.push(i);
    else if (C[i] > (P[i + 1] - P[i - 199]) / 200) ok.push(i);
  }
  const holds = trades.map((t) => t.x - t.e);
  const actual = mean(trades.map((t) => C[t.x] / C[t.e] - 1));
  const draws = [];
  for (let b = 0; b < BOOT; b++) {
    let sum = 0;
    for (const h of holds) {
      let i;
      do i = ok[Math.floor(rnd() * ok.length)];
      while (i + h > LAST);
      sum += C[i + h] / C[i] - 1;
    }
    draws.push(sum / holds.length);
  }
  return { actual, mean: mean(draws), sd: sdev(draws), p: draws.filter((d) => d >= actual).length / BOOT };
}

function autocorr(rs, lag) {
  const m = mean(rs);
  let num = 0;
  let den = 0;
  for (let k = 0; k < rs.length; k++) {
    den += (rs[k] - m) ** 2;
    if (k >= lag) num += (rs[k] - m) * (rs[k - lag] - m);
  }
  return num / den;
}

// --- run ----------------------------------------------------------------------------------------
const series = {};
for (const t of [...MINUTE_TICKERS, ...DAILY_ONLY]) series[t] = loadTicker(t);

const VARIANTS = [
  { id: 'P', label: 'P ★ RSI2<10, >SMA200, exit >SMA5, 15:55', cfg: {} },
  { id: 'SC', label: 'SC same-close (look-ahead)', cfg: { dec: 'close' } },
  { id: 'D1550', label: 'decision 15:50', cfg: { dec: 10 } },
  { id: 'T5', label: 'RSI2 < 5', cfg: { thr: 5 } },
  { id: 'T15', label: 'RSI2 < 15', cfg: { thr: 15 } },
  { id: 'T25', label: 'RSI2 < 25', cfg: { thr: 25 } },
  { id: 'X70', label: 'exit RSI2 > 70', cfg: { exit: 'rsi70' } },
  { id: 'NOF', label: 'no 200-day filter', cfg: { filter: false } },
  { id: 'LATE', label: 'entry one day later', cfg: { delay: 1 } },
  { id: 'CUT', label: "Cutler's RSI", cfg: { rsi: 'cutler' } },
];

console.log(`H8 RSI(2). Window: daily returns ${dates[START + 1]} → ${dates[LAST]} (${LAST - START} days); first entry ${FIRST_ENTRY}.`);
for (const t of MINUTE_TICKERS)
  console.log(`${t}: decision fallbacks to the official close: 15:55 ${series[t].fallbacks[5]}, 15:50 ${series[t].fallbacks[10]} window days`);

const results = {};
for (const v of VARIANTS) {
  const tickers = v.id === 'SC' ? [...MINUTE_TICKERS, ...DAILY_ONLY] : MINUTE_TICKERS;
  for (const t of tickers) {
    const trades = runRule(series[t], v.cfg);
    results[`${v.id}|${t}`] = {
      trades,
      ...Object.fromEntries(Object.entries(COSTS).map(([k, c]) => [k, stats(series[t], trades, c)])),
    };
  }
}

// Primary table
const line = (name, st) =>
  `${padR(name, 22)}${pad(st.n, 5)}${pad(st.hold.toFixed(1), 6)}${pad(pct(st.hit, 0), 6)}${pad(pct(st.meanTrade, 2), 8)}${pad(f2(st.tTrade), 7)}${pad(pct(st.cagr), 8)}${pad(f2(st.sharpe), 7)}${pad(f2(st.tEx), 7)}${pad(pct(st.dd), 8)}${pad(pct(st.tim, 0), 6)}${pad(bp(st.perDayIn), 7)}${pad(bp(st.perDayAll), 7)}${pad(bp(st.gap), 7)}${pad(f2(st.tGap), 7)}`;
const header = `${padR('', 22)}${pad('n', 5)}${pad('hold', 6)}${pad('hit', 6)}${pad('trade', 8)}${pad('t', 7)}${pad('CAGR', 8)}${pad('Shrp', 7)}${pad('tEx', 7)}${pad('maxDD', 8)}${pad('TIM', 6)}${pad('in/d', 7)}${pad('all/d', 7)}${pad('gap', 7)}${pad('tGap', 7)}`;

console.log('\n=== Primary P (15:55 decision, closing-auction fill) ===');
console.log('(trade = mean net trade; t per trade; Sharpe and tEx on daily excess of BIL; in/d, all/d, gap in bp per day; tGap Welch in-market days vs all days)');
console.log(header);
for (const t of MINUTE_TICKERS) {
  const R = results[`P|${t}`];
  for (const k of Object.keys(COSTS)) console.log(line(`${t} ${k}`, R[k]));
  const b = benchmarks(series[t], R.primary.tim);
  console.log(
    `${padR(`${t} buy & hold`, 22)} CAGR ${pct(b.bh.cagr)}  Sharpe ${f2(b.bh.sharpe)}  maxDD ${pct(b.bh.dd)}  worst day ${pct(b.bh.worstDay)}  vol ${pct(b.bh.vol)}`,
  );
  console.log(
    `${padR(`${t} same-exposure mix`, 22)} weight ${pct(R.primary.tim, 0)}: CAGR ${pct(b.mix.cagr)}  Sharpe ${f2(b.mix.sharpe)}  maxDD ${pct(b.mix.dd)}`,
  );
  const p = R.primary;
  console.log(
    `  primary extras: median trade ${pct(p.medTrade, 2)}, worst trade ${pct(p.worstTrade, 2)}, worst day ${pct(p.worstDay)}, vol ${pct(p.vol)}; in-market vs out-of-market days gap ${bp(p.gapOut)} bp t ${f2(p.tGapOut)}`,
  );
  console.log(
    `  without 5 best trades: mean ${pct(p.meanNo5, 2)} t ${f2(p.tNo5)}; without 5 best days: CAGR ${pct(p.cagrNo5)} tEx ${f2(p.tExNo5)}; open at end: ${R.trades.filter((x) => x.open).length}`,
  );
  const b1 = bootstrap(series[t], R.trades, false, 1);
  const b2 = bootstrap(series[t], R.trades, true, 2);
  console.log(
    `  bootstrap (gross mean trade ${pct(b1.actual, 3)}): random entries ${pct(b1.mean, 3)} ± ${pct(b1.sd, 3)}, p ${b1.p.toFixed(4)}; random entries on filter-true days ${pct(b2.mean, 3)} ± ${pct(b2.sd, 3)}, p ${b2.p.toFixed(4)}`,
  );
}

console.log('\n=== P per year (primary 1 bp): trades by exit year (n, sum of net), per-day gap in-market − all days (bp), strategy return, B&H return ===');
for (const t of MINUTE_TICKERS) {
  const p = results[`P|${t}`].primary;
  let pos = 0;
  const rows = Object.entries(p.years).map(([y, Y]) => {
    const g = mean(Y.inR) - mean(Y.all);
    if (Y.inR.length && g > 0) pos++;
    return `  ${y}: n ${pad(Y.n, 2)} sum ${pad(pct(Y.sum, 1), 7)}  in-days ${pad(Y.inR.length, 3)}  gap ${pad(Y.inR.length ? bp(g) : 'n/a', 6)}  strat ${pad(pct(compound(Y.r) - 1), 7)}  B&H ${pad(pct(compound(Y.all) - 1), 7)}`;
  });
  console.log(`${t}: gap positive in ${pos} of ${rows.length} years`);
  console.log(rows.join('\n'));
}

console.log('\n=== Same-close vs 15:55 (how much the look-ahead matters), primary 1 bp ===');
console.log(header);
for (const t of MINUTE_TICKERS) {
  console.log(line(`${t} P 15:55`, results[`P|${t}`].primary));
  console.log(line(`${t} SC close`, results[`SC|${t}`].primary));
  const a = new Set(results[`P|${t}`].trades.map((x) => `${x.e}-${x.x}`));
  const b = results[`SC|${t}`].trades.map((x) => `${x.e}-${x.x}`);
  const ae = new Set(results[`P|${t}`].trades.map((x) => x.e));
  console.log(
    `  identical trades ${b.filter((k) => a.has(k)).length} of ${b.length} (SC) / ${a.size} (P); same entry day ${results[`SC|${t}`].trades.filter((x) => ae.has(x.e)).length}`,
  );
}

console.log('\n=== Same-close on daily-only ETFs (information only), primary 1 bp ===');
console.log(header);
for (const t of DAILY_ONLY) {
  const st = results[`SC|${t}`].primary;
  const b = benchmarks(series[t], st.tim);
  console.log(`${line(t, st)}   B&H CAGR ${pct(b.bh.cagr)} Sh ${f2(b.bh.sharpe)}`);
}

console.log('\n=== Robustness grid (information only), primary 1 bp; stress-cost mean trade in last column ===');
console.log(`${header}${pad('3bp tr', 8)}`);
for (const v of VARIANTS) {
  for (const t of MINUTE_TICKERS) {
    const R = results[`${v.id}|${t}`];
    console.log(`${line(`${v.id} ${t}`, R.primary)}${pad(pct(R.stress.meanTrade, 2), 8)}`);
  }
}
console.log('Variants:');
for (const v of VARIANTS) console.log(`  ${padR(v.id, 6)} ${v.label}`);

console.log('\n=== Daily return autocorrelation (adjusted close-to-close), lags 1–5 ===');
for (const t of MINUTE_TICKERS) {
  const s = series[t];
  console.log(`${t}:${padR('', 4)}${[1, 2, 3, 4, 5].map((l) => pad(`lag${l}`, 8)).join('')}   n`);
  const yrs = [...new Set(dates.slice(1).map((d) => d.slice(0, 4)))];
  for (const y of yrs) {
    const rs = s.ret.filter((_, i) => i > 0 && dates[i].startsWith(y));
    console.log(`  ${y}   ${[1, 2, 3, 4, 5].map((l) => pad(autocorr(rs, l).toFixed(3), 8)).join('')}   ${rs.length}`);
  }
  const rs = s.ret.slice(1);
  const ac = [1, 2, 3, 4, 5].map((l) => autocorr(rs, l));
  console.log(`  all    ${ac.map((a) => pad(a.toFixed(3), 8)).join('')}   ${rs.length}`);
  console.log(`  t≈ρ√n  ${ac.map((a) => pad((a * Math.sqrt(rs.length)).toFixed(2), 8)).join('')}`);
  const sumNeg = [1, 2, 3, 4, 5].map((l) => yrs.filter((y) => autocorr(s.ret.filter((_, i) => i > 0 && dates[i].startsWith(y)), l) < 0).length);
  console.log(`  years negative of ${yrs.length}: ${sumNeg.join(', ')}`);
}
