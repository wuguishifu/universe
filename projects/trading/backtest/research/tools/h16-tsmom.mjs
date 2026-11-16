// H16: time-series momentum across ~26 ETFs (Moskowitz, Ooi and Pedersen 2012).
// Pre-registration: research/hypotheses/h16.md. Standalone; reads data/daily/<T>.json only.
// Usage: node research/tools/h16-tsmom.mjs [--check-only]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DAILY = path.join(ROOT, 'data/daily');
const CHECK_ONLY = process.argv.includes('--check-only');

// ---- ETF set (pre-registered) -------------------------------------------------------------
const CLASSES = {
  Equities: ['SPY', 'IWM', ['VGK', 'IEV'], 'EWJ', 'EEM'],
  Bonds: ['SHY', 'IEF', 'TLT', 'TIP', 'LQD', 'HYG', 'EMB', 'BWX'],
  Commodities: ['GLD', 'SLV', ['USO', 'DBO'], 'UNG', 'DBA', 'DBB'],
  RealEstate: ['VNQ'],
  Currencies: ['FXE', 'FXY', 'FXB', 'FXA', 'FXC', 'FXF'],
};
const CASH = 'BIL';
const NOT_SHORTABLE_NOW = new Set(['BWX', 'USO', 'FXE', 'FXB', 'FXC']);
const START = '2017-03-01';
const END = '2026-11-13';
const FIRST_BAR = '2016-01-04';

const readBars = (t) => {
  const f = path.join(DAILY, `${t}.json`);
  if (!fs.existsSync(f)) return null;
  const txt = fs.readFileSync(f, 'utf8');
  if (txt.trim().length < 3) return null;
  const bars = JSON.parse(txt);
  return bars.length ? bars : null;
};

// ---- Load and align ------------------------------------------------------------------------
const spyBars = readBars('SPY');
const dates = spyBars.map((b) => b.t.slice(0, 10)).filter((d) => d >= FIRST_BAR && d <= END);
const dIdx = new Map(dates.map((d, i) => [d, i]));
const notes = [];
const assets = []; // {t, cls}
const O = {}, C = {};
function loadAligned(t) {
  const bars = readBars(t);
  if (!bars) return false;
  const first = bars[0].t.slice(0, 10);
  if (first > FIRST_BAR) {
    notes.push(`${t}: first bar ${first}, after ${FIRST_BAR}`);
    return false;
  }
  const byDate = new Map(bars.map((b) => [b.t.slice(0, 10), b]));
  const o = new Float64Array(dates.length), c = new Float64Array(dates.length);
  let missing = [];
  for (let i = 0; i < dates.length; i++) {
    const b = byDate.get(dates[i]);
    if (b) { o[i] = b.o; c[i] = b.c; }
    else {
      missing.push(dates[i]);
      o[i] = c[i] = i ? c[i - 1] : NaN;
    }
  }
  const last = bars.at(-1).t.slice(0, 10);
  if (last < END) notes.push(`${t}: last bar ${last}, before ${END}`);
  if (missing.length) notes.push(`${t}: ${missing.length} SPY dates without a bar, carried forward (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''})`);
  const extra = bars.filter((b) => { const d = b.t.slice(0, 10); return d >= FIRST_BAR && d <= END && !dIdx.has(d); }).length;
  if (extra) notes.push(`${t}: ${extra} bars on dates SPY doesn't have (ignored)`);
  O[t] = o; C[t] = c;
  return true;
}
for (const [cls, list] of Object.entries(CLASSES)) {
  for (const entry of list) {
    const choices = Array.isArray(entry) ? entry : [entry];
    let used = null;
    for (const t of choices) {
      if (loadAligned(t)) { used = t; break; }
      notes.push(`${t}: not usable (missing/empty/short file)`);
    }
    if (used) {
      if (used !== choices[0]) notes.push(`${choices[0]} replaced by pre-named fallback ${used}`);
      assets.push({ t: used, cls });
    } else notes.push(`market of ${choices[0]} dropped: no usable ETF`);
  }
}
if (!loadAligned(CASH)) throw new Error('BIL missing');
for (const t of ['SPY', 'IEF']) if (!C[t]) loadAligned(t);

const N_DAYS = dates.length;
const ret = {}; // close-to-close simple returns, ret[t][i] = C[i]/C[i-1]-1
for (const t of Object.keys(C)) {
  const r = new Float64Array(N_DAYS);
  for (let i = 1; i < N_DAYS; i++) r[i] = C[t][i] / C[t][i - 1] - 1;
  ret[t] = r;
}

// ---- Data check ----------------------------------------------------------------------------
const out = [];
const p = (...a) => out.push(a.join(' '));
p(`# H16 time-series momentum — ${new Date().toISOString()}`);
p(`Dates: ${dates[0]} → ${dates.at(-1)}, ${N_DAYS} SPY trading days. Window ${START} → ${END}.`);
p(`ETFs used (${assets.length}): ${Object.keys(CLASSES).map((c) => `${c}: ${assets.filter((a) => a.cls === c).map((a) => a.t).join(' ')}`).join(' | ')}`);
p('\n## Data check');
for (const n of notes) p('- ' + n);
const big = [];
for (const { t } of [...assets, { t: CASH }]) {
  for (let i = 1; i < N_DAYS; i++) {
    const r = ret[t][i];
    if (Math.abs(r) > 0.25) big.push(`${t} ${dates[i]} ${(r * 100).toFixed(1)}%`);
    const on = O[t][i] / C[t][i - 1] - 1;
    if (Math.abs(on) > 0.25) big.push(`${t} ${dates[i]} overnight ${(on * 100).toFixed(1)}%`);
  }
}
p(`- Daily or overnight moves beyond ±25%: ${big.length ? big.join('; ') : 'none'}`);
if (CHECK_ONLY) { console.log(out.join('\n')); process.exit(0); }

// ---- Schedules -----------------------------------------------------------------------------
const startIdx = dates.findIndex((d) => d >= START);
const weekKey = (d) => { // Monday of that week
  const dt = new Date(d + 'T12:00:00Z');
  const dow = (dt.getUTCDay() + 6) % 7;
  return new Date(dt.getTime() - dow * 86400000).toISOString().slice(0, 10);
};
function tradeDays(freq) { // indices of days whose open we trade at (decision at i-1 close)
  const s = new Set([startIdx]);
  for (let i = startIdx; i < N_DAYS - 1; i++) {
    const a = dates[i], b = dates[i + 1];
    const end = freq === 'monthly' ? a.slice(0, 7) !== b.slice(0, 7) : weekKey(a) !== weekKey(b);
    if (end) s.add(i + 1);
  }
  return s;
}
const SCHED = { monthly: tradeDays('monthly'), weekly: tradeDays('weekly') };

// ---- Weights at a decision close -----------------------------------------------------------
function vols(list, d) { // 63-day covariance of daily returns, annualised
  const n = list.length, W = 63;
  const R = list.map((t) => { const a = []; for (let i = d - W + 1; i <= d; i++) a.push(ret[t][i]); return a; });
  const mu = R.map((a) => a.reduce((x, y) => x + y, 0) / W);
  const cov = Array.from({ length: n }, () => new Float64Array(n));
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) {
    let s = 0;
    for (let k = 0; k < W; k++) s += (R[a][k] - mu[a]) * (R[b][k] - mu[b]);
    cov[a][b] = cov[b][a] = (s / (W - 1)) * 252;
  }
  return { cov, sig: list.map((_, a) => Math.sqrt(cov[a][a])) };
}
const lookRet = (t, d, L) => C[t][d] / C[t][d - L] - 1;
function signals(list, d, lookback) { // returns {ls: [-1..1], lf: [0..1]}
  const Ls = lookback === 'blend' ? [63, 126, 252] : [{ 3: 63, 6: 126, 12: 252 }[lookback]];
  const ls = [], lf = [];
  for (const t of list) {
    let s = 0, f = 0;
    for (const L of Ls) {
      const ex = lookRet(t, d, L) - lookRet(CASH, d, L);
      s += Math.sign(ex); f += ex > 0 ? 1 : 0;
    }
    ls.push(s / Ls.length); lf.push(f / Ls.length);
  }
  return { ls, lf };
}
function scaled(x, cov, cap) {
  let v = 0;
  for (let a = 0; a < x.length; a++) for (let b = 0; b < x.length; b++) v += x[a] * x[b] * cov[a][b];
  const k = v > 0 ? 0.10 / Math.sqrt(v) : 0;
  let w = x.map((y) => y * k);
  const G = w.reduce((s, y) => s + Math.abs(y), 0);
  let capped = false;
  if (cap && G > cap) { w = w.map((y) => (y * cap) / G); capped = true; }
  return { w, capped };
}
// cfg: {variant: 'LS'|'LF'|'BENCH', lookback, volScale, freq, subset, cap}
function targetWeights(cfg, list, d) {
  const n = list.length;
  if (!cfg.volScale) {
    if (cfg.variant === 'BENCH') return { w: list.map(() => 1 / n), capped: false };
    const { ls, lf } = signals(list, d, cfg.lookback);
    return { w: (cfg.variant === 'LS' ? ls : lf).map((s) => s / n), capped: false };
  }
  const { cov, sig } = vols(list, d);
  if (cfg.variant === 'BENCH') return scaled(sig.map((s) => 1 / s), cov, cfg.cap);
  const { ls, lf } = signals(list, d, cfg.lookback);
  if (cfg.variant === 'LS') return scaled(sig.map((s, a) => ls[a] / s), cov, cfg.cap);
  const b = scaled(sig.map((s) => 1 / s), cov, cfg.cap); // LF = benchmark × share positive
  return { w: b.w.map((y, a) => y * lf[a]), capped: b.capped };
}
const fixedWeights = (wmap) => (list) => ({ w: list.map((t) => wmap[t] ?? 0), capped: false });

// ---- Simulator -----------------------------------------------------------------------------
// fin: 'retail' (short proceeds earn nothing) | 'futures' (short proceeds earn BIL)
function simulate({ list, weightsAt, freq, bps, fin = 'retail' }) {
  const sched = SCHED[freq];
  const n = list.length;
  let units = new Float64Array(n), F = 1, Q = 0; // free cash (BIL if ≥0, loan if <0), short proceeds
  let prevNav = 1;
  const daily = []; // {date, r, rf}
  const contrib = new Float64Array(n); // sum of daily excess contributions
  let costSum = 0, turnSum = 0, rebal = 0, cappedN = 0;
  const gross = [], netExp = [], shortNS = [];
  const shortByAsset = new Float64Array(n);
  let tradeLog = [];
  for (let i = startIdx; i < N_DAYS; i++) {
    const rf = ret[CASH][i];
    const vStart = list.map((t, a) => units[a] * C[list[a]][i - 1]);
    let pnl = list.map((t, a) => units[a] * (O[t][i] - C[t][i - 1]));
    let expo = vStart.slice(); // exposure for subtracting rf in contributions
    if (sched.has(i)) {
      // overnight P&L, then rebalance at the open
      const vOpen = list.map((t, a) => units[a] * O[t][i]);
      const Fopen = F >= 0 ? F * (O[CASH][i] / C[CASH][i - 1]) : F; // BIL holding marks at open
      const navOpen = vOpen.reduce((s, v) => s + v, 0) + Fopen + Q;
      const { w, capped } = weightsAt(list, i - 1);
      if (capped) cappedN++;
      rebal++;
      const L = w.reduce((s, y) => s + Math.max(0, y), 0), S = w.reduce((s, y) => s + Math.max(0, -y), 0);
      let turn = w.reduce((s, y, a) => s + Math.abs(y * navOpen - vOpen[a]), 0) + Math.abs(Math.max(0, (1 - L) * navOpen) - Math.max(0, Fopen));
      const cost = (turn * bps) / 1e4;
      const after = navOpen - cost;
      turnSum += turn / navOpen; costSum += cost / navOpen;
      const newUnits = w.map((y, a) => (y * after) / O[list[a]][i]);
      // intraday P&L on new units
      pnl = list.map((t, a) => pnl[a] + newUnits[a] * (C[t][i] - O[t][i]));
      units = Float64Array.from(newUnits);
      Q = S * after;
      F = after - w.reduce((s, y) => s + y * after, 0) - Q;
      // F now marked at the open; accrue open→close for BIL part
      F = F >= 0 ? F * (C[CASH][i] / O[CASH][i]) : F * (1 + rf + 0.015 / 252);
      if (fin === 'futures') Q *= 1 + rf;
      expo = w.map((y) => y * after);
      gross.push(w.reduce((s, y) => s + Math.abs(y), 0)); netExp.push(L - S); shortNS.push(S);
      w.forEach((y, a) => { if (y < 0) shortByAsset[a] += -y; });
      tradeLog.push({ date: dates[i], w });
    } else {
      pnl = list.map((t, a) => units[a] * (C[t][i] - C[t][i - 1]));
      F = F >= 0 ? F * (1 + rf) : F * (1 + rf + 0.015 / 252);
      if (fin === 'futures') Q *= 1 + rf;
    }
    // borrow fee on shorts (value at close)
    const shortVal = list.reduce((s, t, a) => s + Math.max(0, -units[a] * C[t][i]), 0);
    F -= (shortVal * 0.01) / 252;
    const nav = list.reduce((s, t, a) => s + units[a] * C[t][i], 0) + F + Q;
    const r = nav / prevNav - 1;
    for (let a = 0; a < n; a++) contrib[a] += pnl[a] / prevNav - (expo[a] / prevNav) * rf;
    daily.push({ date: dates[i], r, rf });
    prevNav = nav;
  }
  const years = daily.length / 252;
  return {
    daily, contrib: Array.from(contrib, (x) => x / years), list,
    turnover: turnSum / years, costs: costSum / years, rebal, cappedShare: cappedN / Math.max(1, rebal),
    avgGross: mean(gross), avgNet: mean(netExp), avgShort: mean(shortNS),
    shortShareNotShortable: (() => { const tot = shortByAsset.reduce((s, x) => s + x, 0); return tot ? list.reduce((s, t, a) => s + (NOT_SHORTABLE_NOW.has(t) ? shortByAsset[a] : 0), 0) / tot : 0; })(),
    tradeLog,
  };
}
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }

// ---- Statistics ----------------------------------------------------------------------------
function monthly(daily) {
  const m = new Map();
  for (const { date, r, rf } of daily) {
    const k = date.slice(0, 7);
    const e = m.get(k) ?? { r: 1, rf: 1 };
    e.r *= 1 + r; e.rf *= 1 + rf; m.set(k, e);
  }
  return [...m].map(([k, e]) => ({ k, r: e.r - 1, ex: e.r - e.rf }));
}
function stats(daily) {
  const n = daily.length;
  const ex = daily.map((d) => d.r - d.rf);
  const mu = mean(ex), sd = Math.sqrt(ex.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1));
  const rs = daily.map((d) => d.r), mr = mean(rs);
  const vol = Math.sqrt(rs.reduce((s, x) => s + (x - mr) ** 2, 0) / (n - 1) * 252);
  let nav = 1, peak = 1, mdd = 0;
  for (const d of daily) { nav *= 1 + d.r; peak = Math.max(peak, nav); mdd = Math.min(mdd, nav / peak - 1); }
  const yrs = (Date.parse(daily.at(-1).date) - Date.parse(daily[0].date)) / (365.25 * 864e5);
  const mon = monthly(daily);
  const byYear = {};
  for (const d of daily) byYear[d.date.slice(0, 4)] = ((byYear[d.date.slice(0, 4)] ?? 0) + 1) * (1 + d.r) - 1;
  const span = (a, b) => daily.filter((d) => d.date >= a && d.date <= b).reduce((s, d) => s * (1 + d.r), 1) - 1;
  return {
    cagr: nav ** (1 / yrs) - 1, vol, sharpe: (mu / sd) * Math.sqrt(252), mdd,
    worstMonth: Math.min(...mon.map((m) => m.r)), mon, byYear,
    covid: span('2020-02-01', '2020-03-31'), y2022: byYear['2022'], apr2025: span('2025-04-01', '2025-04-30'),
  };
}
function ols(y, X) { // X: array of rows (with intercept), returns {b, se HC1, t}
  const n = y.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Float64Array(k)), Xty = new Float64Array(k);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const inv = invert(XtX);
  const b = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const e = y.map((yi, i) => yi - X[i].reduce((s, v, j) => s + v * b[j], 0));
  const meat = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) meat[a][c] += X[i][a] * X[i][c] * e[i] * e[i];
  const V = mul(mul(inv, meat), inv).map((row) => row.map((v) => (v * n) / (n - k)));
  const se = b.map((_, a) => Math.sqrt(V[a][a]));
  const s2 = e.reduce((s, x) => s + x * x, 0) / (n - k);
  const seOls = b.map((_, a) => Math.sqrt(s2 * inv[a][a]));
  return { b, se, t: b.map((v, a) => v / se[a]), tOls: b.map((v, a) => v / seOls[a]), resid: e };
}
function mul(A, B) { return A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0))); }
function invert(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map((r) => r.slice(n));
}
function alphaVs(sStats, bStats) {
  const bm = new Map(bStats.mon.map((m) => [m.k, m.ex]));
  const rows = sStats.mon.filter((m) => bm.has(m.k));
  const res = ols(rows.map((m) => m.ex), rows.map((m) => [1, bm.get(m.k)]));
  const resid = res.resid; const rsd = Math.sqrt(resid.reduce((s, x) => s + x * x, 0) / (resid.length - 2));
  return { alpha: res.b[0] * 12, beta: res.b[1], t: res.t[0], tOls: res.tOls[0], ir: (res.b[0] / rsd) * Math.sqrt(12), n: rows.length };
}
function gapStats(sStats, bStats, dropBest = 0) {
  const bm = new Map(bStats.mon.map((m) => [m.k, m.r]));
  let g = sStats.mon.filter((m) => bm.has(m.k)).map((m) => m.r - bm.get(m.k));
  if (dropBest) g = g.sort((a, b) => b - a).slice(dropBest);
  const mu = mean(g), sd = Math.sqrt(g.reduce((s, x) => s + (x - mu) ** 2, 0) / (g.length - 1));
  return { perYear: mu * 12, t: mu / (sd / Math.sqrt(g.length)) };
}
function corr(a, b) {
  const ma = mean(a), mb = mean(b);
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(sa * sb);
}
function corrSpy(s, spy) {
  const m = new Map(spy.mon.map((x) => [x.k, x.r]));
  const rows = s.mon.filter((x) => m.has(x.k));
  return corr(rows.map((x) => x.r), rows.map((x) => m.get(x.k)));
}
const dropYear = (daily, y) => daily.filter((d) => !d.date.startsWith(y));

// ---- Configs ------------------------------------------------------------------------------
const ALL = assets.map((a) => a.t);
const EQ = assets.filter((a) => a.cls === 'Equities').map((a) => a.t);
const EXEQ = assets.filter((a) => a.cls !== 'Equities').map((a) => a.t);
const base = { lookback: 12, volScale: true, freq: 'monthly', subset: 'all', cap: 2 };
const CONFIGS = [
  { id: '1★', variant: 'LS', ...base },
  { id: '2★', variant: 'LF', ...base },
  { id: '3', variant: 'LS', ...base, lookback: 3 },
  { id: '4', variant: 'LS', ...base, lookback: 6 },
  { id: '5', variant: 'LS', ...base, lookback: 'blend' },
  { id: '6', variant: 'LF', ...base, lookback: 'blend' },
  { id: '7', variant: 'LS', ...base, volScale: false, cap: null },
  { id: '8', variant: 'LF', ...base, volScale: false, cap: null },
  { id: '9', variant: 'LS', ...base, freq: 'weekly' },
  { id: '10', variant: 'LF', ...base, freq: 'weekly' },
  { id: '11', variant: 'LS', ...base, subset: 'eq' },
  { id: '12', variant: 'LS', ...base, subset: 'exeq' },
  { id: '13', variant: 'LF', ...base, subset: 'eq' },
  { id: '14', variant: 'LF', ...base, subset: 'exeq' },
  { id: '15', variant: 'LS', ...base, cap: null },
];
const listOf = (s) => ({ all: ALL, eq: EQ, exeq: EXEQ }[s]);
const label = (c) => `${c.variant} ${c.lookback === 'blend' ? 'blend' : c.lookback + 'm'}${c.volScale ? '' : ' no-vol'} ${c.freq}${c.subset === 'all' ? '' : ' ' + c.subset}${c.cap ? '' : ' nocap'}`;
const benchCfg = (c) => ({ ...c, variant: 'BENCH', lookback: 12 });
const benchKey = (c) => `${c.volScale}|${c.freq}|${c.subset}|${c.cap}`;

const runCache = new Map();
function run(cfg, bps, fin = 'retail') {
  const key = cfg.variant === 'BENCH' ? `B|${benchKey(cfg)}|${bps}|${fin}` : `${cfg.id}|${bps}|${fin}`;
  if (runCache.has(key)) return runCache.get(key);
  const list = listOf(cfg.subset);
  const r = simulate({ list, weightsAt: (l, d) => targetWeights(cfg, l, d), freq: cfg.freq, bps, fin });
  r.s = stats(r.daily);
  runCache.set(key, r);
  return r;
}
function runFixed(wmap, bps) {
  const list = Object.keys(wmap);
  const r = simulate({ list, weightsAt: fixedWeights(wmap), freq: 'monthly', bps });
  r.s = stats(r.daily);
  return r;
}

const pct = (x, d = 1) => (x == null ? '—' : (x * 100).toFixed(d) + '%');
const f2 = (x) => (x == null ? '—' : x.toFixed(2));
const f3 = (x) => x.toFixed(3);

const spy = { 5: runFixed({ SPY: 1 }, 5), 15: runFixed({ SPY: 1 }, 15), 0: runFixed({ SPY: 1 }, 0) };
const sixty = { 5: runFixed({ SPY: 0.6, IEF: 0.4 }, 5), 15: runFixed({ SPY: 0.6, IEF: 0.4 }, 15) };

p('\n## Reference benchmarks (5 bp)');
p('| | CAGR | Vol | Sharpe | Max DD | Worst month | Feb–Mar 2020 | 2022 | Apr 2025 |');
p('|---|---|---|---|---|---|---|---|---|');
for (const [nm, r] of [['SPY buy & hold', spy[5]], ['60/40 SPY/IEF', sixty[5]]]) {
  const s = r.s;
  p(`| ${nm} | ${pct(s.cagr)} | ${pct(s.vol)} | ${f3(s.sharpe)} | ${pct(s.mdd)} | ${pct(s.worstMonth)} | ${pct(s.covid)} | ${pct(s.y2022)} | ${pct(s.apr2025)} |`);
}
p(`SPY at 15 bp Sharpe ${f3(spy[15].s.sharpe)}; 60/40 at 15 bp Sharpe ${f3(sixty[15].s.sharpe)}. Part 2 check: SPY 14.3% CAGR, Sharpe 0.70, max DD −33.8%; 60/40 9.1%, 0.65, −21.2%.`);

// ---- Primary ------------------------------------------------------------------------------
function row(nm, r, extra = '') {
  const s = r.s;
  return `| ${nm} | ${pct(s.cagr)} | ${pct(s.vol)} | ${f3(s.sharpe)} | ${pct(s.mdd)} | ${pct(s.worstMonth)} | ${f2(corrSpy(s, spy[5].s))} | ${pct(s.covid)} | ${pct(s.y2022)} | ${pct(s.apr2025)} | ${f2(r.avgGross)} | ${f2(r.avgNet)} | ${pct(r.cappedShare, 0)} | ${f2(r.turnover)} |${extra}`;
}
const HDR = '| | CAGR | Vol | Sharpe | Max DD | Worst month | Corr SPY | Feb–Mar 2020 | 2022 | Apr 2025 | Avg gross | Avg net | Cap binds | Turnover/yr |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
const verdicts = [];
for (const cfg of CONFIGS.slice(0, 2)) {
  const b = benchCfg(cfg);
  const R = { 0: run(cfg, 0), 5: run(cfg, 5), 15: run(cfg, 15) };
  const B = { 0: run(b, 0), 5: run(b, 5), 15: run(b, 15) };
  p(`\n## Primary ${cfg.id} ${label(cfg)}`);
  p(HDR);
  p(row(`**${cfg.variant} 5 bp**`, R[5]));
  p(row('Equal-risk long 5 bp', B[5]));
  p(row(`${cfg.variant} 15 bp`, R[15]));
  p(row('Equal-risk long 15 bp', B[15]));
  p(row(`${cfg.variant} 0 bp`, R[0]));
  p(row('Equal-risk long 0 bp', B[0]));
  if (cfg.variant === 'LS') {
    const Fu = run(cfg, 5, 'futures');
    p(row('LS 5 bp, futures-like financing (info)', Fu));
    p(`Avg short exposure ${f2(R[5].avgShort)} of NAV; share of short exposure in ETFs Alpaca now flags not shortable (BWX USO FXE FXB FXC): ${pct(R[5].shortShareNotShortable, 0)}.`);
  }
  const a5 = alphaVs(R[5].s, B[5].s), a15 = alphaVs(R[15].s, B[15].s), aS = alphaVs(R[5].s, spy[5].s);
  const g = gapStats(R[5].s, B[5].s), g5 = gapStats(R[5].s, B[5].s, 5);
  p(`Alpha vs equal-risk (5 bp): ${pct(a5.alpha, 2)}/yr, beta ${f2(a5.beta)}, HC1 t ${f2(a5.t)} (OLS t ${f2(a5.tOls)}), appraisal ratio ${f2(a5.ir)}, ${a5.n} months. At 15 bp: ${pct(a15.alpha, 2)}/yr, t ${f2(a15.t)}.`);
  p(`Alpha vs SPY (5 bp, info): ${pct(aS.alpha, 2)}/yr, beta ${f2(aS.beta)}, HC1 t ${f2(aS.t)}.`);
  p(`Monthly gap vs equal-risk: ${pct(g.perYear, 2)}/yr, t ${f2(g.t)}; without the 5 best months ${pct(g5.perYear, 2)}/yr, t ${f2(g5.t)}.`);
  for (const y of ['2020', '2022']) {
    const sr = stats(dropYear(R[5].daily, y)), sb = stats(dropYear(B[5].daily, y));
    p(`Without ${y} (info): Sharpe ${f3(sr.sharpe)} vs equal-risk ${f3(sb.sharpe)}.`);
  }
  const half = (r, a, z) => stats(r.daily.filter((d) => d.date >= a && d.date <= z)).sharpe;
  p(`Halves (info): 2017-03→2021-12 Sharpe ${f3(half(R[5], '2017', '2021-12-31'))} vs ${f3(half(B[5], '2017', '2021-12-31'))}; 2022→2026-11 ${f3(half(R[5], '2022', '2027'))} vs ${f3(half(B[5], '2022', '2027'))}.`);
  p('\nPer year (5 bp): ' + Object.keys(R[5].s.byYear).map((y) => `${y} ${pct(R[5].s.byYear[y])} (bench ${pct(B[5].s.byYear[y])}, SPY ${pct(spy[5].s.byYear[y])})`).join('; '));
  // contributions
  const clsOf = new Map(assets.map((a) => [a.t, a.cls]));
  const byCls = (r) => { const m = {}; r.list.forEach((t, a) => { m[clsOf.get(t)] = (m[clsOf.get(t)] ?? 0) + r.contrib[a]; }); return m; };
  const cR = byCls(R[5]), cB = byCls(B[5]);
  const exMean = (r) => mean(r.daily.map((d) => d.r - d.rf)) * 252;
  p('\nContribution to annual excess return by class (arithmetic, 5 bp):');
  p('| Class | ' + cfg.variant + ' | Equal-risk |\n|---|---|---|');
  for (const c of Object.keys(CLASSES)) p(`| ${c} | ${pct(cR[c], 2)} | ${pct(cB[c], 2)} |`);
  const sum = (m) => Object.values(m).reduce((s, x) => s + x, 0);
  p(`| Costs, financing, borrow (residual) | ${pct(exMean(R[5]) - sum(cR), 2)} | ${pct(exMean(B[5]) - sum(cB), 2)} |`);
  p(`| Total excess (mean daily × 252) | ${pct(exMean(R[5]), 2)} | ${pct(exMean(B[5]), 2)} |`);
  p('By ETF (' + cfg.variant + ' / bench): ' + R[5].list.map((t, a) => `${t} ${(R[5].contrib[a] * 100).toFixed(2)}/${(B[5].contrib[a] * 100).toFixed(2)}`).join(', '));
  // average weights
  const avgW = (r) => r.list.map((_, a) => mean(r.tradeLog.map((x) => x.w[a])));
  const avgAbs = (r) => r.list.map((_, a) => mean(r.tradeLog.map((x) => Math.abs(x.w[a]))));
  const wl = avgW(R[5]), wa = avgAbs(R[5]), wb = avgW(B[5]);
  p('Average weight (signed / |w| / bench): ' + R[5].list.map((t, a) => `${t} ${wl[a].toFixed(2)}/${wa[a].toFixed(2)}/${wb[a].toFixed(2)}`).join(', '));
  // pass rule
  const c1 = R[5].s.sharpe > B[5].s.sharpe && R[15].s.sharpe > B[15].s.sharpe;
  const c2 = R[5].s.mdd > B[5].s.mdd;
  const c3 = R[5].s.y2022 > 0;
  const c4 = a5.alpha > 0 && a5.t >= 1.5;
  const v = c1 && c2 && c3 && c4 ? 'PASS' : c1 && c2 && c3 ? 'INCONCLUSIVE (behaves as published)' : 'FAIL';
  p(`\nPass rule: (1) Sharpe > bench at 5 and 15 bp: ${f3(R[5].s.sharpe)} vs ${f3(B[5].s.sharpe)}, ${f3(R[15].s.sharpe)} vs ${f3(B[15].s.sharpe)} → ${c1 ? '✓' : '✗'}; (2) max DD ${pct(R[5].s.mdd)} vs ${pct(B[5].s.mdd)} → ${c2 ? '✓' : '✗'}; (3) 2022 ${pct(R[5].s.y2022)} → ${c3 ? '✓' : '✗'}; (4) alpha t ${f2(a5.t)} ≥ 1.5 → ${c4 ? '✓' : '✗'}. **${v}**`);
  verdicts.push(`${cfg.id} ${cfg.variant}: ${v}`);
}

// ---- Grid ---------------------------------------------------------------------------------
p('\n## All configs (5 bp; each vs its own matched equal-risk / equal-weight long benchmark)');
p('| # | Config | CAGR | Sharpe | Max DD | 2022 | Bench Sharpe | Bench max DD | Bench 2022 | Sharpe gap | 15 bp gap | Alpha/yr | HC1 t | Corr SPY | Avg gross |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const cfg of CONFIGS) {
  const b = benchCfg(cfg);
  const R5 = run(cfg, 5), B5 = run(b, 5), R15 = run(cfg, 15), B15 = run(b, 15);
  const a = alphaVs(R5.s, B5.s);
  p(`| ${cfg.id} | ${label(cfg)} | ${pct(R5.s.cagr)} | ${f3(R5.s.sharpe)} | ${pct(R5.s.mdd)} | ${pct(R5.s.y2022)} | ${f3(B5.s.sharpe)} | ${pct(B5.s.mdd)} | ${pct(B5.s.y2022)} | ${(R5.s.sharpe - B5.s.sharpe >= 0 ? '+' : '') + f3(R5.s.sharpe - B5.s.sharpe)} | ${(R15.s.sharpe - B15.s.sharpe >= 0 ? '+' : '') + f3(R15.s.sharpe - B15.s.sharpe)} | ${pct(a.alpha, 1)} | ${f2(a.t)} | ${f2(corrSpy(R5.s, spy[5].s))} | ${f2(R5.avgGross)} |`);
}
p('\nVerdicts: ' + verdicts.join('; '));
console.log(out.join('\n'));
