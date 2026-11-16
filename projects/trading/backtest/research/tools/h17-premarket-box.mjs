// H17: pre-market box (09:00–09:30) breakout on 5-minute closes, stop at the far side, 3R target,
// 15-minute EMA 50/200 trend filter. Design and pass rule: research/hypotheses/h17.md.
//
// usage:
//   node research/tools/h17-premarket-box.mjs [data dir]
//   node research/tools/h17-premarket-box.mjs [data dir] --check QQQ 2024-03-05
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith('--') ? args[0] : 'data';
const checkIdx = args.indexOf('--check');
const CHECK = checkIdx >= 0 ? { ticker: args[checkIdx + 1], date: args[checkIdx + 2] } : null;
const WARM_FROM = '2015-12-01';
const FIRST_DATE = '2016-01-04';
const LAST_DATE = '2026-11-13';
const HALF_SPLIT = '2021-01-01';
const NQ_PER_QQQ = 41;
const SHARE_COST = 1e-4; // per side, information only

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noonUtc).split(':').map(Number);
  return noonUtc - (h * 60 + m) * 60_000;
};
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date >= WARM_FROM && d.date <= LAST_DATE,
);

// --- loading: one day as minute-of-day arrays, plus the EMA states completed that day ----------
function makeEma(n) {
  const a = 2 / (n + 1);
  let v = NaN;
  return (x) => (v = Number.isNaN(v) ? x : v + a * (x - v));
}

function loadTicker(ticker) {
  const emaAll = [makeEma(50), makeEma(200)];
  const emaRth = [makeEma(50), makeEma(200)];
  const days = [];
  for (const day of calendar) {
    const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
    if (!existsSync(path)) continue;
    const bars = JSON.parse(readFileSync(path, 'utf8'));
    if (!bars.length) continue;
    const midnight = nyMidnight(day.date);
    const O = new Float64Array(1440).fill(NaN);
    const H = new Float64Array(1440).fill(NaN);
    const L = new Float64Array(1440).fill(NaN);
    const C = new Float64Array(1440).fill(NaN);
    for (const b of bars) {
      const m = (Date.parse(b.t) - midnight) / 60_000;
      if (m >= 0 && m < 1440 && b.v > 0) {
        O[m] = b.o;
        H[m] = b.h;
        L[m] = b.l;
        C[m] = b.c;
      }
    }
    const open = hhmm(day.open);
    const close = hhmm(day.close);
    // 15-minute buckets; state recorded at each bucket's end minute
    const all = [];
    const rth = [];
    for (let s = 240; s < 1200; s += 15) {
      let c = NaN;
      for (let m = s; m < s + 15; m++) if (!Number.isNaN(C[m])) c = C[m];
      if (Number.isNaN(c)) continue;
      all.push([s + 15, emaAll[0](c), emaAll[1](c)]);
      if (s >= open && s + 15 <= close) rth.push([s + 15, emaRth[0](c), emaRth[1](c)]);
    }
    days.push({ date: day.date, open, close, O, H, L, C, all, rth });
  }
  // EMA state at minute T of day i: last record at or before T, else the previous day's last.
  const stateAt = (i, T, which) => {
    for (let j = i; j >= 0; j--) {
      const recs = days[j][which];
      for (let k = recs.length - 1; k >= 0; k--) if (j < i || recs[k][0] <= T) return recs[k];
    }
    return null;
  };
  return { days, stateAt };
}

// --- one ticker-day ----------------------------------------------------------------------------
function simulate(t, i, cfg, log) {
  const d = t.days[i];
  let hi = -Infinity;
  let lo = Infinity;
  let nBox = 0;
  for (let m = 540; m < 570; m++) {
    if (Number.isNaN(d.H[m])) continue;
    nBox++;
    hi = Math.max(hi, d.H[m]);
    lo = Math.min(lo, d.L[m]);
  }
  if (nBox < 20) return { skip: 'thin box' };
  log?.(`box 09:00–09:30 from ${nBox} bars: ${lo} – ${hi}`);

  let side = 0;
  let brkEnd = -1;
  for (let s = d.open; s <= d.open + 55; s += 5) {
    let c = NaN;
    for (let m = s; m < s + 5; m++) if (!Number.isNaN(d.C[m])) c = d.C[m];
    if (Number.isNaN(c)) continue;
    if (c > hi) side = 1;
    else if (c < lo) side = -1;
    if (side) {
      brkEnd = s + 5;
      log?.(`breakout: 5-min bar ${clock(s)} closed ${c} → ${side > 0 ? 'long' : 'short'}`);
      break;
    }
  }
  if (!side) return { skip: 'no breakout' };

  if (cfg.filter) {
    const st = t.stateAt(i, brkEnd, cfg.filter);
    if (!st) return { skip: 'no ema' };
    log?.(`EMA50 ${st[1].toFixed(3)} EMA200 ${st[2].toFixed(3)} as of ${clock(st[0])}`);
    if ((st[1] > st[2] ? 1 : -1) !== side) return { skip: 'filter' };
  }

  let em = -1;
  const from = brkEnd + (cfg.delay ?? 0);
  for (let m = from; m < from + 5; m++)
    if (!Number.isNaN(d.O[m])) {
      em = m;
      break;
    }
  if (em < 0) return { skip: 'no entry bar' };
  const entry = d.O[em];
  const stop = side > 0 ? lo : hi;
  const risk = side * (entry - stop);
  if (risk <= 0) return { skip: 'entry beyond stop' };
  const target = cfg.target ? entry + side * cfg.target * risk : NaN;
  const flat = Math.min(cfg.flat, d.close - 5);
  log?.(`entry ${clock(em)} @ ${entry}, stop ${stop}, target ${target}, R ${risk.toFixed(3)}`);

  let exit = NaN;
  let how = '';
  let xm = -1;
  for (let m = em; m < flat; m++) {
    if (Number.isNaN(d.O[m])) continue;
    const o = d.O[m];
    if (side * (o - stop) <= 0) [exit, how] = [o, 'stop gap'];
    else if (cfg.target && side * (o - target) >= 0) [exit, how] = [target, 'target'];
    else if ((side > 0 ? d.L[m] : -d.H[m]) <= side * stop) [exit, how] = [stop, 'stop'];
    else if (cfg.target && (side > 0 ? d.H[m] : -d.L[m]) >= side * target) [exit, how] = [target, 'target'];
    if (how) {
      xm = m;
      break;
    }
  }
  if (!how) {
    for (let m = flat; m < d.close && Number.isNaN(exit); m++) if (!Number.isNaN(d.O[m])) [exit, xm] = [d.O[m], m];
    for (let m = flat - 1; m > em && Number.isNaN(exit); m--) if (!Number.isNaN(d.C[m])) [exit, xm] = [d.C[m], m];
    how = 'flat';
  }
  log?.(`exit ${clock(xm)} @ ${exit} (${how})`);
  return { side, entry, exit, risk, how, R: (side * (exit - entry)) / risk };
}

// --- costs, in price units per share per round trip --------------------------------------------
const costFns = {
  primary: (r, qqqPx) => (1 / NQ_PER_QQQ) * (r.entry / qqqPx),
  stress: (r, qqqPx) => (3 / NQ_PER_QQQ) * (r.entry / qqqPx),
  zero: () => 0,
  shares: (r) => SHARE_COST * (r.entry + r.exit),
  // information only: 1 point plus 2 more points of slippage on every stop exit
  stopslip: (r, qqqPx) => ((r.how.startsWith('stop') ? 3 : 1) / NQ_PER_QQQ) * (r.entry / qqqPx),
};

function stats(rs) {
  const n = rs.length;
  if (!n) return { n: 0 };
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  let eq = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq - peak);
  }
  const sorted = [...rs].sort((a, b) => b - a);
  const no5 = sorted.slice(5).reduce((a, b) => a + b, 0) / Math.max(1, n - 5);
  return { n, mean, t: (mean / sd) * Math.sqrt(n), win: rs.filter((r) => r > 0).length / n, dd, total: eq, no5 };
}
const f = (x, d = 3) => (x >= 0 ? '+' : '') + x.toFixed(d);
const line = (label, s) =>
  s.n
    ? `${label.padEnd(34)} n ${String(s.n).padStart(5)}  win ${(100 * s.win).toFixed(1)}%  mean ${f(s.mean)}R  t ${f(s.t, 2).padStart(6)}  total ${f(s.total, 1).padStart(7)}R  maxDD ${s.dd.toFixed(1)}R  w/o best 5 ${f(s.no5)}R`
    : `${label.padEnd(34)} n 0`;

// --- run ---------------------------------------------------------------------------------------
const P = { filter: 'all', target: 3, flat: 955 };
const CONFIGS = {
  P,
  'no filter': { ...P, filter: null },
  'flat 15:00': { ...P, flat: 900 },
  'target 2R': { ...P, target: 2 },
  'target 4R': { ...P, target: 4 },
  'no target': { ...P, target: 0 },
  'RTH-only EMAs': { ...P, filter: 'rth' },
};

const DIAG = args.includes('--diag');
const tickers = {};
for (const tk of ['QQQ', 'SPY', 'IWM']) tickers[tk] = loadTicker(tk);
const qqqPx = new Map(tickers.QQQ.days.map((d) => [d.date, d.O[570] || d.C[569] || NaN]));

if (CHECK) {
  const t = tickers[CHECK.ticker];
  const i = t.days.findIndex((d) => d.date === CHECK.date);
  const r = simulate(t, i, P, (s) => console.log(s));
  console.log(r);
  process.exit(0);
}

function run(tk, cfg) {
  const t = tickers[tk];
  const trades = [];
  const skips = {};
  t.days.forEach((d, i) => {
    if (d.date < FIRST_DATE) return;
    const r = simulate(t, i, cfg);
    if (r.skip) skips[r.skip] = (skips[r.skip] ?? 0) + 1;
    else trades.push({ ...r, date: d.date, year: d.date.slice(0, 4), qqq: qqqPx.get(d.date) });
  });
  return { trades, skips, days: t.days.filter((d) => d.date >= FIRST_DATE).length };
}
const netR = (trades, cost) =>
  trades.map((r) => r.R - costFns[cost](r, Number.isNaN(r.qqq) ? r.entry : r.qqq) / r.risk);

const out = [];
const log = (s = '') => {
  out.push(s);
  console.log(s);
};
log(`H17 pre-market box breakout, ${FIRST_DATE} → ${LAST_DATE}`);
log(`costs: primary = 1 NQ point round trip ($1/${NQ_PER_QQQ} per QQQ share), stress = 3 points, shares = 1 bp per side`);
log();

const results = {};
for (const tk of ['QQQ', 'SPY', 'IWM']) {
  for (const [name, cfg] of Object.entries(CONFIGS)) {
    if (tk !== 'QQQ' && name !== 'P' && name !== 'no filter') continue;
    results[`${tk} ${name}`] = run(tk, cfg);
  }
}

log('== QQQ, P (filter on, 3R, flat 15:55) ==');
{
  const { trades, skips, days } = results['QQQ P'];
  log(`days ${days}, trades ${trades.length}, skipped ${JSON.stringify(skips)}`);
  for (const c of ['zero', 'primary', 'stress', 'shares']) log(line(`cost ${c}`, stats(netR(trades, c))));
  const riskBp = trades.map((r) => (1e4 * r.risk) / r.entry).sort((a, b) => a - b);
  log(`risk (1R) in bp of price: median ${riskBp[riskBp.length >> 1].toFixed(1)}, p10 ${riskBp[Math.floor(riskBp.length * 0.1)].toFixed(1)}, p90 ${riskBp[Math.floor(riskBp.length * 0.9)].toFixed(1)}`);
  const hows = {};
  for (const r of trades) hows[r.how] = (hows[r.how] ?? 0) + 1;
  log(`exits ${JSON.stringify(hows)}; long ${trades.filter((r) => r.side > 0).length}, short ${trades.filter((r) => r.side < 0).length}`);
  const prim = netR(trades, 'primary');
  log('per year (primary):');
  for (let y = 2016; y <= 2026; y++) {
    const rs = prim.filter((_, k) => trades[k].year === String(y));
    log(line(`  ${y}${y === 2026 ? ' (to 11-13)' : ''}`, stats(rs)));
  }
  log(line('half 2016–2020', stats(prim.filter((_, k) => trades[k].date < HALF_SPLIT))));
  log(line('half 2021–2026', stats(prim.filter((_, k) => trades[k].date >= HALF_SPLIT))));
  log(line('long only', stats(prim.filter((_, k) => trades[k].side > 0))));
  log(line('short only', stats(prim.filter((_, k) => trades[k].side < 0))));
}
log();
log('== all configs (primary cost; zero cost in brackets) ==');
for (const [key, { trades }] of Object.entries(results)) {
  const s = stats(netR(trades, 'primary'));
  const z = stats(netR(trades, 'zero'));
  log(`${line(key, s)}  [zero: ${f(z.mean)}R t ${f(z.t, 2)}]`);
}
log();
log('== pass rule (QQQ, P, primary) ==');
{
  const tr = results['QQQ P'].trades;
  const prim = netR(tr, 'primary');
  const s = stats(prim);
  const years = [];
  for (let y = 2016; y <= 2025; y++) years.push(stats(prim.filter((_, k) => tr[k].year === String(y))).mean > 0);
  const h1 = stats(prim.filter((_, k) => tr[k].date < HALF_SPLIT)).mean;
  const h2 = stats(prim.filter((_, k) => tr[k].date >= HALF_SPLIT)).mean;
  const st = stats(netR(tr, 'stress')).mean;
  const nf = stats(netR(results['QQQ no filter'].trades, 'primary')).mean;
  const spy = stats(netR(results['SPY P'].trades, 'primary')).mean;
  const checks = [
    [`mean ${f(s.mean)}R, t ${f(s.t, 2)} (needs > 0, t ≥ 2.5)`, s.mean > 0 && s.t >= 2.5],
    [`${years.filter(Boolean).length} of 10 full years positive (needs 7)`, years.filter(Boolean).length >= 7],
    [`halves ${f(h1)}R / ${f(h2)}R (both > 0)`, h1 > 0 && h2 > 0],
    [`stress ${f(st)}R (> 0)`, st > 0],
    [`filter ${f(s.mean)}R vs no filter ${f(nf)}R (filter better)`, s.mean > nf],
    [`SPY ${f(spy)}R (> 0)`, spy > 0],
  ];
  checks.forEach(([text, ok], k) => log(`${k + 1}. ${text}: ${ok ? 'pass' : 'FAIL'}`));
  const verdict = checks.every((c) => c[1]) ? 'PASS' : s.mean <= 0 ? 'FAIL' : 'INCONCLUSIVE';
  log(`verdict: ${verdict}`);
}

// --- post-hoc diagnostics (information only; added after the PASS above, see h17.md note 1) ----
if (DIAG) {
  log();
  log('== diagnostics (information only, post hoc) ==');
  const tr = results['QQQ P'].trades;
  log(line('QQQ P, stop exits slip 2 more points', stats(netR(tr, 'stopslip'))));
  for (const delay of [1, 2]) {
    const r = run('QQQ', { ...P, delay });
    log(line(`QQQ P, entry +${delay} min`, stats(netR(r.trades, 'primary'))));
  }
  // Does the breakout matter, or only the trend? Hold the filter's side 09:35 open → 15:55 open.
  const t = tickers.QQQ;
  const bp = (xs) => {
    const n = xs.length;
    const m = xs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
    return `n ${n}  mean ${f(m, 2)} bp  t ${f((m / sd) * Math.sqrt(n), 2)}`;
  };
  const pBp = tr.map((r) => (1e4 * r.side * (r.exit - r.entry)) / r.entry);
  log(`QQQ P trades in bp of price, zero cost:                ${bp(pBp)}`);
  const ctrl = { all: [], pDays: [], opposed: [], longAll: [] };
  const pDays = new Set(tr.map((r) => r.date));
  const res = new Map();
  t.days.forEach((d, i) => {
    if (d.date < FIRST_DATE) return;
    const o = d.O[575];
    const flat = Math.min(955, d.close - 5);
    const x = d.O[flat];
    if (Number.isNaN(o) || Number.isNaN(x)) return;
    const st = t.stateAt(i, 575, 'all');
    if (!st) return;
    const side = st[1] > st[2] ? 1 : -1;
    const v = (1e4 * side * (x - o)) / o;
    ctrl.all.push(v);
    ctrl.longAll.push((1e4 * (x - o)) / o);
    if (pDays.has(d.date)) ctrl.pDays.push(v);
    const r = simulate(t, i, P);
    if (r.skip === 'filter') ctrl.opposed.push(v);
    res.set(d.date, r);
  });
  log(`control: always long 09:35 → 15:55:                    ${bp(ctrl.longAll)}`);
  log(`control: filter side 09:35 → 15:55, every day:         ${bp(ctrl.all)}`);
  // Opposed days, traded the breakout's way anyway (= no filter minus P)
  const nf = results['QQQ no filter'].trades.filter((r) => !pDays.has(r.date));
  log(line('breakouts against the filter (no-filter minus P)', stats(netR(nf, 'primary'))));
  const thin = {};
  for (const d of t.days) if (d.date >= FIRST_DATE && res.get(d.date)?.skip === 'thin box') thin[d.date.slice(0, 4)] = (thin[d.date.slice(0, 4)] ?? 0) + 1;
  log(`thin-box skips by year: ${JSON.stringify(thin)}`);
  // Money terms: fixed 1% risk per trade, compounding, no financing
  let eq = 1;
  let peak = 1;
  let dd = 0;
  for (const r of netR(tr, 'primary')) {
    eq *= 1 + 0.01 * r;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq / peak - 1);
  }
  const yrs = (Date.parse(LAST_DATE) - Date.parse(FIRST_DATE)) / (365.25 * 864e5);
  log(`1% risk per trade, primary cost: CAGR ${(100 * (eq ** (1 / yrs) - 1)).toFixed(1)}%, max DD ${(100 * dd).toFixed(1)}%`);
}
