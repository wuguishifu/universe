// H4: volatility-managed exposure (Moreira & Muir 2017), as pre-registered in research/hypotheses/h4.md.
// usage: node research/tools/h4-vol-managed.mjs [data dir] [intraday cache file]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const dataDir = process.argv[2] ?? 'data';
const cacheFile = process.argv[3];

const START = '2016-04-01'; // first trade (open), all configs and benchmarks
const FIRST_DECISION = '2016-03-31';
const END = '2026-11-13';
const PART2_FROM = '2017-03-01';
const TARGET = 0.16;
const LEVER_SPREAD = 0.015; // a year over BIL on borrowed money

// --- data ---------------------------------------------------------------------------------------
const loadDaily = (t) =>
  JSON.parse(readFileSync(`${dataDir}/daily/${t}.json`, 'utf8')).map((b) => ({
    date: b.t.slice(0, 10),
    o: b.o,
    c: b.c,
  }));
const TICKERS = ['SPY', 'QQQ', 'IWM', 'EFA'];
const bilBars = loadDaily('BIL');
const dates = bilBars.map((b) => b.date).filter((d) => d <= END);
const series = {};
for (const t of [...TICKERS, 'BIL']) {
  const map = new Map(loadDaily(t).map((b) => [b.date, b]));
  const o = [];
  const c = [];
  for (const d of dates) {
    const bar = map.get(d);
    if (!bar) throw new Error(`${t} missing ${d}`);
    o.push(bar.o);
    c.push(bar.c);
  }
  series[t] = { o, c };
}
const idx = new Map(dates.map((d, i) => [d, i]));
const startIdx = idx.get(START);
const firstDecisionIdx = idx.get(FIRST_DECISION);
if (startIdx === undefined || firstDecisionIdx !== startIdx - 1)
  throw new Error('start dates not trading days');

const month = (d) => d.slice(0, 7);
const isMonthEnd = (i) => i + 1 < dates.length && month(dates[i + 1]) !== month(dates[i]);
const weekNo = (d) => Math.floor((Date.parse(d) / 86_400_000 + 3) / 7);
const isWeekEnd = (i) => i + 1 < dates.length && weekNo(dates[i + 1]) !== weekNo(dates[i]);

/** Daily simple returns on adjusted closes; r[0] = NaN. */
const dailyRet = (t) => series[t].c.map((c, i) => (i === 0 ? NaN : c / series[t].c[i - 1] - 1));
const rets = Object.fromEntries(TICKERS.map((t) => [t, dailyRet(t)]));

/** Month key → indices of trading days with a return. */
const monthDays = new Map();
for (let i = 1; i < dates.length; i++) {
  const m = month(dates[i]);
  if (!monthDays.has(m)) monthDays.set(m, []);
  monthDays.get(m).push(i);
}
const monthKeys = [...monthDays.keys()];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

/** Close-to-close RV per month, annualised. */
const monthlyRV = Object.fromEntries(
  TICKERS.map((t) => [
    t,
    new Map(monthKeys.map((m) => [m, 252 * mean(monthDays.get(m).map((i) => rets[t][i] ** 2))])),
  ]),
);

// --- intraday realised variance -----------------------------------------------------------------
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

/** For one day: {first open, last close, sum of squared 5-minute log returns} or null. */
function sessionStats(t, d) {
  const file = `${dataDir}/stocks/${t}/${d}.json`;
  const cal = calendar.get(d);
  if (!cal || !existsSync(file)) return null;
  const off = utcOffsetMin(d);
  const open = hm(cal.open);
  const close = hm(cal.close);
  const bars = JSON.parse(readFileSync(file, 'utf8'))
    .map((b) => {
      const u = new Date(b.t);
      return { m: u.getUTCHours() * 60 + u.getUTCMinutes() + off, o: b.o, c: b.c };
    })
    .filter((b) => b.m >= open && b.m < close)
    .sort((a, b) => a.m - b.m);
  if (bars.length < 30) return null;
  const p0 = bars[0].o;
  let prev = p0;
  let sum = 0;
  let j = 0;
  let last = null;
  for (let mark = open + 5; mark <= close; mark += 5) {
    while (j < bars.length && bars[j].m <= mark - 1) last = bars[j++].c;
    if (last === null) continue;
    sum += Math.log(last / prev) ** 2;
    prev = last;
  }
  return { open: p0, close: bars.at(-1).c, sum };
}

function intradayDailyRV(t) {
  if (cacheFile && existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'))[t];
    if (cached) return new Map(Object.entries(cached));
  }
  const out = new Map();
  let prevStats = null;
  const allDays = [...calendar.keys()].filter((d) => d >= '2015-12-01' && d <= END).sort();
  let bigGaps = 0;
  for (const d of allDays) {
    const s = sessionStats(t, d);
    if (s && prevStats) {
      const on = Math.log(s.open / prevStats.close);
      if (Math.abs(on) > 0.2) bigGaps++;
      else out.set(d, on * on + s.sum);
    }
    prevStats = s;
  }
  if (bigGaps) console.error(`${t}: ${bigGaps} overnight gaps > 20% skipped`);
  return out;
}
const intradayRV = {};
const intradayFallbacks = {};
for (const t of ['SPY', 'QQQ', 'IWM']) {
  const daily = intradayDailyRV(t);
  intradayRV[t] = new Map();
  intradayFallbacks[t] = [];
  for (const m of monthKeys) {
    const vals = monthDays
      .get(m)
      .map((i) => daily.get(dates[i]))
      .filter((v) => v !== undefined);
    if (vals.length >= 10) intradayRV[t].set(m, 252 * mean(vals));
    else {
      intradayRV[t].set(m, monthlyRV[t].get(m));
      intradayFallbacks[t].push(`${m} (${vals.length} days)`);
    }
  }
  intradayRV[t].dailyCount = daily.size;
  intradayRV[t].daily = daily;
}
if (cacheFile && !existsSync(cacheFile)) {
  writeFileSync(
    cacheFile,
    JSON.stringify(
      Object.fromEntries(
        Object.entries(intradayRV).map(([t, m]) => [t, Object.fromEntries(m.daily)]),
      ),
    ),
  );
}

// --- signals ------------------------------------------------------------------------------------
/** RV known at the close of day i, per variant. */
function rvAt(cfg, i) {
  const t = cfg.ticker;
  const m = month(dates[i]);
  if (cfg.lookback === '1m') return monthlyRV[t].get(m);
  if (cfg.lookback === 'intraday') return intradayRV[t].get(m);
  if (cfg.lookback === '3m') {
    const k = monthKeys.indexOf(m);
    const days = monthKeys.slice(Math.max(0, k - 2), k + 1).flatMap((x) => monthDays.get(x));
    return 252 * mean(days.map((d) => rets[t][d] ** 2));
  }
  if (cfg.lookback === '21d') {
    const xs = [];
    for (let d = i - 20; d <= i; d++) xs.push(rets[t][d] ** 2);
    return 252 * mean(xs);
  }
  throw new Error(cfg.lookback);
}
function targetVarAt(cfg, i) {
  if (cfg.target === 'fixed') return TARGET ** 2;
  // expanding: mean monthly RV from the first month through the month just measured
  const m = month(dates[i]);
  const k = monthKeys.indexOf(m);
  return mean(monthKeys.slice(0, k + 1).map((x) => monthlyRV[cfg.ticker].get(x)));
}
function weightAt(cfg, i) {
  const rv = rvAt(cfg, i);
  if (cfg.paperC !== undefined) return cfg.paperC / rv;
  const tv = targetVarAt(cfg, i);
  const raw = cfg.scaling === 'variance' ? tv / rv : Math.sqrt(tv / rv);
  return Math.min(cfg.cap, raw);
}
const isDecision = (cfg, i) =>
  i === firstDecisionIdx || (i > firstDecisionIdx && (cfg.weekly ? isWeekEnd(i) : isMonthEnd(i)));

// --- simulator (shares held between rebalances, as in Part 2) -----------------------------------
/** weightFn(i) → weight decided at close of day i, or undefined if not a decision day. */
function simulate(ticker, weightFn, costBps) {
  const A = series[ticker];
  const B = series.BIL;
  let sa = 0;
  let sb = 0;
  let loan = 0;
  let pending;
  let started = false;
  let prevValue = 1;
  const points = [];
  const rebalances = [];
  for (let i = firstDecisionIdx; i < dates.length; i++) {
    let loanRef = B.c[i - 1];
    let firstDay = false;
    if (pending !== undefined) {
      const w = pending;
      const value = started ? sa * A.o[i] + sb * B.o[i] - loan : 1;
      const wantA = w * value;
      const wantB = Math.max(0, 1 - w) * value;
      const turnover = Math.abs(wantA - sa * A.o[i]) + Math.abs(wantB - sb * B.o[i]);
      const cost = (turnover * costBps) / 10_000;
      const after = value - cost;
      sa = (w * after) / A.o[i];
      sb = (Math.max(0, 1 - w) * after) / B.o[i];
      loan = Math.max(0, w - 1) * after;
      loanRef = B.o[i];
      rebalances.push({ date: dates[i], w, turnover: turnover / value });
      pending = undefined;
      if (!started) firstDay = true;
      started = true;
    }
    if (started) {
      loan *= (B.c[i] / loanRef) * (1 + LEVER_SPREAD / 252);
      const value = sa * A.c[i] + sb * B.c[i] - loan;
      const cr = firstDay ? B.c[i] / B.o[i] - 1 : B.c[i] / B.c[i - 1] - 1;
      points.push({ date: dates[i], r: value / prevValue - 1, cr, w: (sa * A.c[i]) / value });
      prevValue = value;
    }
    if (i + 1 < dates.length) {
      const w = weightFn(i);
      if (w !== undefined) pending = w;
    }
  }
  return { points, rebalances };
}

// --- statistics ---------------------------------------------------------------------------------
function stats(points) {
  let v = 1;
  let peak = 1;
  let maxDD = 0;
  let worst = 0;
  const ex = [];
  const rs = [];
  const years = new Map();
  const months = new Map();
  const cashMonths = new Map();
  const comp = (map, k, r) => map.set(k, ((map.get(k) ?? 0) + 1) * (1 + r) - 1);
  for (const p of points) {
    v *= 1 + p.r;
    peak = Math.max(peak, v);
    maxDD = Math.max(maxDD, 1 - v / peak);
    worst = Math.min(worst, p.r);
    ex.push(p.r - p.cr);
    rs.push(p.r);
    comp(years, p.date.slice(0, 4), p.r);
    comp(months, month(p.date), p.r);
    comp(cashMonths, month(p.date), p.cr);
  }
  const yrs =
    (Date.parse(points.at(-1).date) - Date.parse(points[0].date)) / (365.25 * 86_400_000);
  return {
    cagr: v ** (1 / yrs) - 1,
    vol: sdev(rs) * Math.sqrt(252),
    sharpe: (mean(ex) / sdev(ex)) * Math.sqrt(252),
    maxDD,
    worst,
    years,
    months,
    cashMonths,
    n: points.length,
  };
}

/** OLS y = a + b x with plain and White (HC0) t for a. */
function regress(y, x) {
  const n = y.length;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    sxx += (x[k] - mx) ** 2;
    sxy += (x[k] - mx) * (y[k] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const e = y.map((yy, k) => yy - a - b * x[k]);
  const s2 = e.reduce((s, r) => s + r * r, 0) / (n - 2);
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumXX = x.reduce((s, v) => s + v * v, 0);
  const det = n * sumXX - sumX * sumX;
  const seOls = Math.sqrt((s2 * sumXX) / det);
  // HC0: (X'X)^-1 X' diag(e^2) X (X'X)^-1, X = [1, x]
  const inv = [
    [sumXX / det, -sumX / det],
    [-sumX / det, n / det],
  ];
  let m00 = 0;
  let m01 = 0;
  let m11 = 0;
  for (let k = 0; k < n; k++) {
    const e2 = e[k] ** 2;
    m00 += e2;
    m01 += e2 * x[k];
    m11 += e2 * x[k] * x[k];
  }
  const M = [
    [m00, m01],
    [m01, m11],
  ];
  const r0 = [
    inv[0][0] * M[0][0] + inv[0][1] * M[1][0],
    inv[0][0] * M[0][1] + inv[0][1] * M[1][1],
  ];
  const varA = r0[0] * inv[0][0] + r0[1] * inv[1][0];
  return { a, b, tOls: a / seOls, tHc: a / Math.sqrt(varA), n, residSd: Math.sqrt(s2) };
}

const excessMonthly = (st, keep = () => true) => {
  const ks = [...st.months.keys()].filter(keep);
  return { ks, ys: ks.map((k) => st.months.get(k) - st.cashMonths.get(k)) };
};
function alphaVs(st, base, keep) {
  const a = excessMonthly(st, keep);
  const b = excessMonthly(base, keep);
  return regress(a.ys, b.ys);
}
function gap(st, bench, keep = () => true) {
  const ks = [...st.months.keys()].filter(keep);
  const d = ks.map((k) => st.months.get(k) - bench.months.get(k));
  const t = (xs) => mean(xs) / (sdev(xs) / Math.sqrt(xs.length));
  const trimmed = [...d].sort((a, b) => a - b).slice(0, -5);
  return { mean: mean(d) * 12, t: t(d), meanTrim: mean(trimmed) * 12, tTrim: t(trimmed) };
}
const sub = (points, from, to = '9999') => points.filter((p) => p.date >= from && p.date <= to);
const no2020 = (points) => points.filter((p) => !p.date.startsWith('2020'));

// --- configs ------------------------------------------------------------------------------------
const base = { scaling: 'variance', lookback: '1m', target: 'fixed', cap: 1.5 };
const configs = [
  { id: 1, ticker: 'SPY', ...base, star: true },
  { id: 2, ticker: 'SPY', ...base, cap: 1.0 },
  { id: 3, ticker: 'SPY', ...base, cap: 2.0 },
  { id: 4, ticker: 'SPY', ...base, scaling: 'vol', cap: 1.0 },
  { id: 5, ticker: 'SPY', ...base, scaling: 'vol' },
  { id: 6, ticker: 'SPY', ...base, scaling: 'vol', cap: 2.0 },
  { id: 7, ticker: 'SPY', ...base, lookback: '3m' },
  { id: 8, ticker: 'SPY', ...base, scaling: 'vol', lookback: '3m' },
  { id: 9, ticker: 'SPY', ...base, lookback: '21d', weekly: true },
  { id: 10, ticker: 'SPY', ...base, scaling: 'vol', lookback: '21d', weekly: true },
  { id: 11, ticker: 'SPY', ...base, lookback: 'intraday' },
  { id: 12, ticker: 'SPY', ...base, scaling: 'vol', lookback: 'intraday' },
  { id: 13, ticker: 'SPY', ...base, target: 'expanding' },
  { id: 14, ticker: 'SPY', ...base, paper: true, cap: Infinity },
  ...['QQQ', 'IWM', 'EFA'].map((t, k) => ({ id: 15 + k, ticker: t, ...base })),
  ...['QQQ', 'IWM', 'EFA'].map((t, k) => ({ id: 18 + k, ticker: t, ...base, scaling: 'vol' })),
  ...['QQQ', 'IWM', 'EFA'].map((t, k) => ({ id: 21 + k, ticker: t, ...base, target: 'expanding' })),
  ...['QQQ', 'IWM'].map((t, k) => ({ id: 24 + k, ticker: t, ...base, lookback: 'intraday' })),
  ...['QQQ', 'IWM'].map((t, k) => ({ id: 26 + k, ticker: t, ...base, cap: 1.0 })),
];
const label = (c) =>
  c.paper
    ? `${c.ticker} paper c, no cap (ref)`
    : `${c.ticker} ${c.scaling === 'variance' ? 'var' : 'vol'} ${c.lookback}${c.weekly ? ' wkly' : ''} ${c.target === 'fixed' ? '16%' : 'expand'} cap${c.cap}`;

const monthlyFn = (w) => (i) => (isDecision({}, i) ? w : undefined);
const bh = {};
function bhRun(t, bps) {
  const k = `${t}${bps}`;
  if (!bh[k]) bh[k] = simulate(t, monthlyFn(1), bps);
  return bh[k];
}

/** Run a config at a cost; returns managed, same-exposure benchmark, B&H of its ticker and SPY. */
function runConfig(cfg, bps) {
  if (cfg.paper && cfg.paperC === undefined) {
    // full-sample c so daily vol matches SPY buy-and-hold (look-ahead, reference only)
    const target = stats(bhRun('SPY', 5).points).vol;
    let c = TARGET ** 2;
    for (let k = 0; k < 8; k++) {
      const v = stats(simulate('SPY', (i) => (isDecision(cfg, i) ? weightAt({ ...cfg, paperC: c }, i) : undefined), 5).points).vol;
      c *= target / v;
    }
    cfg.paperC = c;
  }
  const m = simulate(cfg.ticker, (i) => (isDecision(cfg, i) ? weightAt(cfg, i) : undefined), bps);
  const exposure = mean(m.rebalances.map((r) => r.w));
  const bench = simulate(cfg.ticker, monthlyFn(exposure), bps);
  return { m, bench, exposure, own: bhRun(cfg.ticker, bps), spy: bhRun('SPY', bps) };
}

// --- report -------------------------------------------------------------------------------------
const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const f2 = (x) => x.toFixed(2);
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
const yrs = (pts) =>
  (Date.parse(pts.at(-1).date) - Date.parse(pts[0].date)) / (365.25 * 86_400_000);
const turnPerYr = (run) => run.rebalances.reduce((a, r) => a + r.turnover, 0) / yrs(run.points);

const out = [];
const log = (s = '') => out.push(s);

log(`H4 volatility-managed exposure. Window ${START} -> ${dates.at(-1)} (trade at open; decisions at close from ${FIRST_DECISION}).`);
log(`Target ${pct(TARGET, 0)}; leverage pays BIL + ${pct(LEVER_SPREAD)}/yr; cash earns BIL. Sharpe = daily excess over BIL x sqrt(252).`);
for (const t of ['SPY', 'QQQ', 'IWM'])
  log(`Intraday RV ${t}: ${intradayRV[t].dailyCount} usable days; months falling back to daily RV: ${intradayFallbacks[t].join(', ') || 'none'}`);
log();

const results = {};
for (const bps of [5, 15]) {
  results[bps] = configs.map((cfg) => ({ cfg, ...runConfig(cfg, bps) }));
}

function row(name, run, exposure) {
  const s = stats(run.points);
  return `${padR(name, 34)} ${pad(pct(s.cagr), 6)} ${pad(pct(s.vol), 6)} ${pad(f2(s.sharpe), 6)} ${pad(pct(-s.maxDD), 7)} ${pad(pct(s.worst), 6)} ${pad(f2(exposure), 5)} ${pad(turnPerYr(run).toFixed(1), 5)}`;
}
const header = `${padR('', 34)} ${pad('CAGR', 6)} ${pad('Vol', 6)} ${pad('Sharpe', 6)} ${pad('MaxDD', 7)} ${pad('Worst', 6)} ${pad('Expo', 5)} ${pad('Turn', 5)}`;

for (const bps of [5, 15]) {
  const r = results[bps][0];
  const s = stats(r.m.points);
  const sb = stats(r.bench.points);
  const ss = stats(r.spy.points);
  const al = alphaVs(s, ss);
  const g = gap(s, sb);
  log(`=== Primary (#1 ${label(r.cfg)}), ${bps} bp per side ===`);
  log(header);
  log(row('Vol-managed SPY *', r.m, r.exposure));
  log(row(`Same-exposure SPY/BIL (w=${f2(r.exposure)})`, r.bench, r.exposure));
  log(row('SPY buy & hold', r.spy, 1));
  log(`Alpha vs SPY: ${pct(al.a * 12, 2)}/yr, beta ${f2(al.b)}, t(HC0) ${f2(al.tHc)}, t(OLS) ${f2(al.tOls)}, n=${al.n} months, appraisal ${f2((al.a / al.residSd) * Math.sqrt(12))}`);
  log(`Gap vs same-exposure (monthly): ${pct(g.mean, 2)}/yr, t ${f2(g.t)}; without 5 best months ${pct(g.meanTrim, 2)}/yr, t ${f2(g.tTrim)}`);
  log();
}

// Bar A and bar B
{
  const f2 = (x) => x.toFixed(3);
  const r5 = results[5];
  const r15 = results[15];
  const S = (run) => stats(run.points);
  const p = r5[0];
  const al = alphaVs(S(p.m), S(p.spy));
  const sharpeGap = (r) => S(r.m).sharpe - S(r.bench).sharpe;
  const byId = (rs, id) => rs.find((x) => x.cfg.id === id);
  const checks = [
    ['1. Sharpe > SPY B&H', S(p.m).sharpe > S(p.spy).sharpe, `${f2(S(p.m).sharpe)} vs ${f2(S(p.spy).sharpe)}`],
    ['2. Sharpe > same-exposure', S(p.m).sharpe > S(p.bench).sharpe, `${f2(S(p.m).sharpe)} vs ${f2(S(p.bench).sharpe)}`],
    ['3. MaxDD smaller than same-exposure', S(p.m).maxDD < S(p.bench).maxDD, `${pct(-S(p.m).maxDD)} vs ${pct(-S(p.bench).maxDD)}`],
    ...[5, 15, 16].map((id) => {
      const r = byId(r5, id);
      return [`4. same sign #${id} ${label(r.cfg)}`, sharpeGap(r) > 0, `Sharpe gap ${f2(sharpeGap(r))}`];
    }),
    [
      '5. at 15 bp, Sharpe > both',
      S(r15[0].m).sharpe > S(r15[0].spy).sharpe && S(r15[0].m).sharpe > S(r15[0].bench).sharpe,
      `${f2(S(r15[0].m).sharpe)} vs SPY ${f2(S(r15[0].spy).sharpe)}, same-exp ${f2(S(r15[0].bench).sharpe)}`,
    ],
  ];
  log('=== Pass rules ===');
  log(`Bar A: alpha vs SPY ${pct(al.a * 12, 2)}/yr, t(HC0) ${f2(al.tHc)} -> ${al.a > 0 && al.tHc >= 2 ? 'PASS' : 'FAIL'}`);
  for (const [name, ok, detail] of checks) log(`Bar B ${padR(name, 48)} ${ok ? 'yes' : 'NO '}  ${detail}`);
  log(`Bar B overall: ${checks.every((c) => c[1]) ? 'PASS' : 'FAIL'}`);
  log();
}

// All configs
for (const bps of [5, 15]) {
  log(`=== All configs, ${bps} bp (managed vs its own same-exposure mix; alpha vs own ticker B&H) ===`);
  log(`${padR('#  config', 40)} ${pad('CAGR', 6)} ${pad('Sharpe', 6)} ${pad('MaxDD', 7)} ${pad('Expo', 5)} ${pad('Turn', 5)} | ${pad('SE Shp', 6)} ${pad('SE DD', 7)} ${pad('B&H Shp', 7)} | ${pad('dShp', 5)} ${pad('alpha', 7)} ${pad('t', 5)} ${pad('beta', 5)} | ${pad('gap/yr', 7)} ${pad('t', 5)}`);
  for (const r of results[bps]) {
    const s = stats(r.m.points);
    const sb = stats(r.bench.points);
    const so = stats(r.own.points);
    const al = alphaVs(s, so);
    const g = gap(s, sb);
    log(`${padR(`${r.cfg.id}${r.cfg.star ? '*' : ' '} ${label(r.cfg)}`, 40)} ${pad(pct(s.cagr), 6)} ${pad(f2(s.sharpe), 6)} ${pad(pct(-s.maxDD), 7)} ${pad(f2(r.exposure), 5)} ${pad(turnPerYr(r.m).toFixed(1), 5)} | ${pad(f2(sb.sharpe), 6)} ${pad(pct(-sb.maxDD), 7)} ${pad(f2(so.sharpe), 7)} | ${pad(f2(s.sharpe - sb.sharpe), 5)} ${pad(pct(al.a * 12, 2), 7)} ${pad(f2(al.tHc), 5)} ${pad(f2(al.b), 5)} | ${pad(pct(g.mean, 2), 7)} ${pad(f2(g.t), 5)}`);
  }
  log();
}
log(`Paper full-sample c (reference): c = ${results[5][13].cfg.paperC.toFixed(5)} (annualised variance units), i.e. w = c / RV; max weight ${f2(Math.max(...results[5][13].m.rebalances.map((x) => x.w)))}, min ${f2(Math.min(...results[5][13].m.rebalances.map((x) => x.w)))}`);
log();

// B&H per ticker
log('=== Buy & hold per ticker, 5 bp ===');
log(header);
for (const t of TICKERS) log(row(`${t} buy & hold`, bhRun(t, 5), 1));
log();

// Primary: windows, without 2020, crisis episodes
{
  const p = results[5][0];
  log('=== Primary cuts (5 bp) ===');
  const cut = (name, f) => {
    const s = stats(f(p.m.points));
    const sb = stats(f(p.bench.points));
    const ss = stats(f(p.spy.points));
    const al = alphaVs(s, ss);
    const g = gap(s, sb);
    log(`${padR(name, 22)} managed Sharpe ${f2(s.sharpe)} CAGR ${pct(s.cagr)} DD ${pct(-s.maxDD)} | same-exp ${f2(sb.sharpe)} ${pct(sb.cagr)} ${pct(-sb.maxDD)} | SPY ${f2(ss.sharpe)} ${pct(ss.cagr)} ${pct(-ss.maxDD)} | alpha ${pct(al.a * 12, 2)} t ${f2(al.tHc)} | gap ${pct(g.mean, 2)} t ${f2(g.t)}`);
  };
  cut('Full window', (x) => x);
  cut('Part 2 window 2017-03+', (x) => sub(x, PART2_FROM));
  cut('Without 2020', no2020);
  cut('2016-04 -> 2020-12', (x) => sub(x, START, '2020-12-31'));
  cut('2021 -> 2026-11', (x) => sub(x, '2021-01-01'));
  log();
  // without-2020 for the other key configs
  log('Without 2020, Sharpe gap vs own same-exposure and alpha vs own B&H:');
  for (const r of results[5]) {
    const s = stats(no2020(r.m.points));
    const sb = stats(no2020(r.bench.points));
    const al = alphaVs(s, stats(no2020(r.own.points)));
    log(`  ${padR(`${r.cfg.id} ${label(r.cfg)}`, 40)} dShp ${pad(f2(s.sharpe - sb.sharpe), 5)}  alpha ${pad(pct(al.a * 12, 2), 7)} t ${pad(f2(al.tHc), 5)}`);
  }
  log();
  const episode = (name, months) => {
    const c = (st) => months.reduce((v, k) => v * (1 + (st.months.get(k) ?? 0)), 1) - 1;
    const s = stats(p.m.points);
    const sb = stats(p.bench.points);
    const ss = stats(p.spy.points);
    log(`  ${padR(name, 18)} managed ${pad(pct(c(s)), 7)}  same-exp ${pad(pct(c(sb)), 7)}  SPY ${pad(pct(c(ss)), 7)}  managed - same-exp ${pad(pct(c(s) - c(sb)), 7)}`);
  };
  log('Crisis episodes (primary, compounded):');
  episode('Feb-Mar 2020', ['2020-02', '2020-03']);
  episode('Apr-Dec 2020', ['2020-04', '2020-05', '2020-06', '2020-07', '2020-08', '2020-09', '2020-10', '2020-11', '2020-12']);
  episode('2022', Array.from({ length: 12 }, (_, k) => `2022-${String(k + 1).padStart(2, '0')}`));
  episode('Apr 2025', ['2025-04']);
  episode('May-Dec 2025', ['2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12']);
  log();
  // per year
  const s = stats(p.m.points);
  const sb = stats(p.bench.points);
  const ss = stats(p.spy.points);
  log('Per year (primary):');
  log(`  ${padR('year', 6)} ${pad('managed', 8)} ${pad('same-exp', 9)} ${pad('SPY', 7)} ${pad('diff', 7)} ${pad('avg w', 6)}`);
  let pos = 0;
  for (const y of s.years.keys()) {
    const ws = p.m.points.filter((x) => x.date.startsWith(y)).map((x) => x.w);
    const d = s.years.get(y) - sb.years.get(y);
    if (d > 0) pos++;
    log(`  ${padR(y, 6)} ${pad(pct(s.years.get(y)), 8)} ${pad(pct(sb.years.get(y)), 9)} ${pad(pct(ss.years.get(y)), 7)} ${pad(pct(d), 7)} ${pad(f2(mean(ws)), 6)}`);
  }
  log(`  managed beat same-exposure in ${pos} of ${s.years.size} calendar years (2016 and 2026 partial)`);
  log();
  // weights
  log('Primary weights at each rebalance (decided at month-end close):');
  const ws = p.m.rebalances;
  for (let k = 0; k < ws.length; k += 12)
    log(`  ${ws[k].date.slice(0, 7)}: ${ws.slice(k, k + 12).map((x) => x.w.toFixed(2)).join(' ')}`);
  const capped = ws.filter((x) => x.w >= 1.5 - 1e-9).length;
  log(`  at cap 1.5: ${capped} of ${ws.length} months; below 1.0: ${ws.filter((x) => x.w < 1).length}`);
}

console.log(out.join('\n'));
