// H10: does the open overreact to the overnight gap? Measurement + gap-fade share strategy.
// Design and pass rule: research/hypotheses/h10.md (pre-registered before this ran).
//
// usage:
//   node research/tools/h10-gap-fade.mjs [data dir]                       full report
//   node research/tools/h10-gap-fade.mjs [data dir] --check SPY 2025-03-04
//        prints the gap, z and the primary trade for one ticker-day, recomputed from the raw
//        files by wall-clock time (slow path), next to the fast-path record.
import { existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dataDir = args[0] && !args[0].startsWith('--') ? args[0] : 'data';
const checkIdx = args.indexOf('--check');
const CHECK = checkIdx >= 0 ? { ticker: args[checkIdx + 1], date: args[checkIdx + 2] } : null;
const FIRST_DATE = '2016-01-04';
const LAST_DATE = '2026-11-13';
const TICKERS = ['SPY', 'QQQ', 'IWM'];
const COSTS = { zero: 0, primary: 1e-4, stress: 3e-4 };
const SD_N = 20;
const DIV_MIN = 5e-4; // factor jump that counts as a dividend
const SPLIT_MAX = 0.05;

// --- time helpers ------------------------------------------------------------------------------

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noonUtc).split(':').map(Number);
  return noonUtc - (h * 60 + m) * 60_000;
};
const calendar = JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).filter(
  (d) => d.date >= '2015-12-01' && d.date <= LAST_DATE,
);

const fomc = new Set(JSON.parse(readFileSync(`${dataDir}/fomc/dates.json`, 'utf8')));
const bls = JSON.parse(readFileSync(`${dataDir}/bls/dates.json`, 'utf8'));
const NEWS = new Set([...fomc, ...bls.cpi, ...bls.empsit]);

// --- loading -----------------------------------------------------------------------------------

/**
 * One session, indexed by k = minutes after the open (k = n is the bar starting at the close
 * time, whose open is the closing auction):
 *   O[k], H[k], L[k] of the bar starting exactly at open+k (NaN if none)
 *   C[k] close of the last bar starting at or before open+k (forward-filled, regular session)
 *   pre  close of the last bar starting at or before 09:27 (price at 09:28), pre-market
 */
function loadSession(ticker, day) {
  const path = `${dataDir}/stocks/${ticker}/${day.date}.json`;
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw.length) return null;
  const midnight = nyMidnight(day.date);
  const open = hhmm(day.open);
  const n = hhmm(day.close) - open;
  const O = new Float64Array(n + 1).fill(NaN);
  const H = new Float64Array(n + 1).fill(NaN);
  const L = new Float64Array(n + 1).fill(NaN);
  const C = new Float64Array(n + 1).fill(NaN);
  let pre = NaN,
    preK = -Infinity;
  for (const b of raw) {
    const k = (Date.parse(b.t) - midnight) / 60_000 - open;
    if (k >= 0 && k <= n) {
      O[k] = b.o;
      H[k] = b.h;
      L[k] = b.l;
      C[k] = b.c;
    } else if (k < 0 && k <= -3 && k > preK) {
      preK = k;
      pre = b.c;
    }
  }
  let c = NaN,
    hi = -Infinity,
    lo = Infinity;
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(C[k])) c = C[k];
    C[k] = c;
    if (!Number.isNaN(H[k])) {
      hi = Math.max(hi, H[k]);
      lo = Math.min(lo, L[k]);
    }
  }
  return { date: day.date, n, O, H, L, C, pre, hasOpen: !Number.isNaN(O[0]), closePx: O[n], hi, lo };
}

/** First bar open at or after k (up to the close bar n); NaN if none within maxWait minutes. */
function openAtOrAfter(s, k, maxWait = Infinity) {
  for (let j = k; j <= s.n && j - k <= maxWait; j++) if (!Number.isNaN(s.O[j])) return s.O[j];
  return NaN;
}
function firstBarAtOrAfter(s, k, maxWait) {
  for (let j = k; j <= s.n && j - k <= maxWait; j++) if (!Number.isNaN(s.O[j])) return j;
  return -1;
}
/** Price at k minutes after the open: open of the first bar starting at or after it. */
function priceAt(s, k) {
  const kk = Math.min(k, s.n);
  const p = openAtOrAfter(s, kk);
  if (!Number.isNaN(p)) return p;
  return s.C[s.n - 1]; // close bar missing: last regular close (counted by caller)
}

function loadDaily(ticker) {
  const daily = JSON.parse(readFileSync(`${dataDir}/daily/${ticker}.json`, 'utf8'));
  const m = new Map();
  for (const b of daily) {
    const date = new Date(Date.parse(b.t) + 12 * 3600_000).toISOString().slice(0, 10);
    m.set(date, b);
  }
  return m;
}

const counts = {};
const bump = (t, key) => {
  counts[t] ??= {};
  counts[t][key] = (counts[t][key] ?? 0) + 1;
};

function loadTicker(ticker) {
  const daily = loadDaily(ticker);
  const sessions = calendar.map((d) => (d.date >= FIRST_DATE ? loadSession(ticker, d) : null));
  const days = []; // valid gap days
  const exDates = [];
  const pastGaps = [];
  let openMismatch = 0,
    openChecked = 0;
  for (let i = 1; i < calendar.length; i++) {
    const s = sessions[i];
    if (!s) continue;
    const p = sessions[i - 1];
    if (!p) {
      bump(ticker, 'prev session missing');
      continue;
    }
    if (!s.hasOpen) {
      bump(ticker, 'no 09:30 bar');
      continue;
    }
    if (Number.isNaN(p.closePx)) {
      bump(ticker, 'prev close bar missing');
      continue;
    }
    if (Number.isNaN(s.closePx)) bump(ticker, 'close bar missing (exit uses last close)');
    const dT = daily.get(s.date);
    const dP = daily.get(p.date);
    let ratio = 1;
    let exDiv = false;
    if (dT && dP && !Number.isNaN(s.closePx)) {
      // Adjustment factor = adjusted daily price / raw price, estimated four ways (open, close,
      // session high, session low). Dividend on day t if the median jump > 5 bp AND at least 3
      // of the 4 jumps exceed 5 bp (see the 2026-11-15 data note in h10.md: the 16:00 bar's
      // open alone is not always the official close, which made spurious "dividends").
      const fac = (db, x) => [db.o / x.O[0], db.c / x.closePx, db.h / x.hi, db.l / x.lo];
      const fT = fac(dT, s),
        fP = fac(dP, p);
      const jumps = fT.map((f, j) => 1 - fP[j] / f).sort((a, b) => a - b);
      const jump = (jumps[1] + jumps[2]) / 2;
      const nAbove = jumps.filter((j) => j > DIV_MIN).length;
      if (Math.abs(jump) > SPLIT_MAX) bump(ticker, `FACTOR JUMP > 5% (split or data error) ${s.date}`);
      else if (jump > DIV_MIN && nAbove >= 3) {
        ratio = 1 - jump;
        exDiv = true;
        exDates.push({ date: s.date, div: p.closePx * jump, pct: jump });
      } else if (nAbove >= 1) bump(ticker, 'factor noise > 5 bp on 1–2 of 4 prices (not a dividend)');
      openChecked++;
      if (Math.abs(dT.c / s.closePx / (dT.o / s.O[0]) - 1) > 5e-4) openMismatch++;
    } else bump(ticker, 'no adjusted daily bar (no dividend check)');
    const Cp = p.closePx * ratio;
    const gap = s.O[0] / Cp - 1;
    let sd = NaN;
    if (pastGaps.length >= SD_N) {
      const w = pastGaps.slice(-SD_N);
      const mu = w.reduce((a, b) => a + b, 0) / SD_N;
      sd = Math.sqrt(w.reduce((a, b) => a + (b - mu) ** 2, 0) / (SD_N - 1));
    }
    pastGaps.push(gap);
    if (Number.isNaN(sd)) {
      bump(ticker, 'sd not ready');
      continue;
    }
    days.push({
      date: s.date,
      year: s.date.slice(0, 4),
      s,
      Cp,
      gap,
      sd,
      z: gap / sd,
      exDiv,
      news: NEWS.has(s.date),
    });
  }
  return { ticker, days, exDates, openMismatch, openChecked };
}

// --- statistics --------------------------------------------------------------------------------

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function tstat(a) {
  const n = a.length;
  if (n < 3) return NaN;
  const m = mean(a);
  const sd = Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1));
  return (m / sd) * Math.sqrt(n);
}
/** OLS y = a + b x with plain and White HC1 t-stats on b. */
function ols(x, y) {
  const n = x.length;
  if (n < 5) return { n, b: NaN, t: NaN, tHC: NaN };
  const mx = mean(x),
    my = mean(y);
  let sxx = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0,
    hc = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - a - b * x[i];
    sse += e * e;
    hc += (x[i] - mx) ** 2 * e * e;
  }
  const seOls = Math.sqrt(sse / (n - 2) / sxx);
  const seHC = Math.sqrt((hc / sxx ** 2) * (n / (n - 2)));
  return { n, a, b, t: b / seOls, tHC: b / seHC };
}
function portfolioStats(daily) {
  // daily: array of portfolio returns over all eligible days, in date order
  const n = daily.length;
  if (!n) return null;
  const m = mean(daily);
  const sd = Math.sqrt(daily.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1));
  let cum = 0,
    peak = 0,
    mdd = 0;
  for (const r of daily) {
    cum += r;
    peak = Math.max(peak, cum);
    mdd = Math.min(mdd, cum - peak);
  }
  return { n, mean: m, sharpe: sd ? (m / sd) * Math.sqrt(252) : NaN, mdd, worst: Math.min(...daily), total: cum };
}

const bp = (x, d = 1) => (x === undefined || Number.isNaN(x) ? '—' : (x * 1e4).toFixed(d));
const pct = (x, d = 1) => (x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
const f2 = (x) => (x === undefined || Number.isNaN(x) ? '—' : x.toFixed(2));
const pad = (s, w) => String(s).padStart(w);
const padE = (s, w) => String(s).padEnd(w);

// --- load --------------------------------------------------------------------------------------

const data = Object.fromEntries(TICKERS.map((t) => [t, loadTicker(t)]));

const P = { zth: 1, entryK: 1, exitK: 60, gapFill: true, news: true, div: 'adjust', moo: false };
if (CHECK) {
  runCheck(CHECK.ticker, CHECK.date);
  process.exit(0);
}

console.log('# H10 gap fade — data checks\n');
for (const t of TICKERS) {
  const d = data[t];
  console.log(
    `${t}: ${d.days.length} valid gap days (${d.days[0].date} → ${d.days.at(-1).date}); ` +
      `close-based and open-based factors differ by > 5 bp (16:00 bar open ≠ official close, or 09:30 open ≠ official open) on ${d.openMismatch}/${d.openChecked} days`,
  );
  for (const [k, v] of Object.entries(counts[t] ?? {})) console.log(`  skipped/flag: ${k}: ${v}`);
  const byYear = {};
  for (const e of d.exDates) (byYear[e.date.slice(0, 4)] ??= []).push(e);
  console.log(`  ex-dividend days detected: ${d.exDates.length}`);
  for (const [y, es] of Object.entries(byYear))
    console.log(
      `    ${y} (${es.length}): ` +
        es.map((e) => `${e.date.slice(5)} $${e.div.toFixed(3)} (${bp(e.pct, 0)}bp)`).join(', '),
    );
}

if (args.includes('--data-only')) process.exit(0);

// --- Part 1: regressions -----------------------------------------------------------------------

const HORIZONS = [
  { name: '10:30', k: 60 },
  { name: '12:00', k: 150 },
  { name: 'close', k: Infinity },
];
const YEARS = [...new Set(data.SPY.days.map((d) => d.year))];

function regRows(days, startK) {
  // startK 0 = opening print; 1 = 09:31 price
  const out = {};
  for (const h of HORIZONS) {
    const x = [],
      y = [];
    for (const d of days) {
      const start = startK === 0 ? d.s.O[0] : openAtOrAfter(d.s, startK, 5);
      if (Number.isNaN(start)) continue;
      x.push(d.gap);
      y.push(priceAt(d.s, h.k) / start - 1);
    }
    out[h.name] = ols(x, y);
  }
  return out;
}

console.log('\n# Part 1 — regression of intraday return on the overnight gap (no trading rule)\n');
console.log('Slope b (negative = fraction of the gap reversed), White HC1 t in brackets, plain OLS t after /.');
for (const [startK, label] of [
  [0, 'from the OPENING PRINT (09:30 open) — the pre-registered effect test'],
  [1, 'from the 09:31 PRICE — what a trader entering after the print can capture (information)'],
]) {
  console.log(`\n## Start ${label}\n`);
  console.log(`${padE('ticker', 7)}${padE('sample', 10)}${pad('n', 6)}  ${HORIZONS.map((h) => padE(`→ ${h.name}`, 26)).join('')}`);
  for (const t of TICKERS) {
    const all = data[t].days;
    const rows = [
      ['all', all],
      ['gap up', all.filter((d) => d.gap > 0)],
      ['gap down', all.filter((d) => d.gap < 0)],
      ['|z|≥1', all.filter((d) => Math.abs(d.z) >= 1)],
    ];
    for (const [name, ds] of rows) {
      const r = regRows(ds, startK);
      console.log(
        `${padE(t, 7)}${padE(name, 10)}${pad(ds.length, 6)}  ` +
          HORIZONS.map((h) => padE(`${f2(r[h.name].b)} (${f2(r[h.name].tHC)} / ${f2(r[h.name].t)})`, 26)).join(''),
      );
    }
  }
  console.log(`\nBy year (b [HC1 t]):`);
  for (const h of HORIZONS) {
    console.log(`\n  → ${h.name}`);
    console.log(`  ${padE('year', 6)}${TICKERS.map((t) => padE(t, 18)).join('')}`);
    for (const y of YEARS) {
      const cells = TICKERS.map((t) => {
        const r = regRows(data[t].days.filter((d) => d.year === y), startK)[h.name];
        return padE(`${f2(r.b)} [${f2(r.tHC)}]`, 18);
      });
      console.log(`  ${padE(y, 6)}${cells.join('')}`);
    }
  }
}

// Conditional means (information): mean open→10:30 and 09:31→10:30 return by z bucket, signed
// so that positive = reversal.
console.log('\n## Mean reversal by gap bucket (−sign(gap) × return, bp), information only\n');
const BUCKETS = [
  ['z ≤ −2', (z) => z <= -2],
  ['−2 < z ≤ −1', (z) => z > -2 && z <= -1],
  ['−1 < z < 0', (z) => z > -1 && z < 0],
  ['0 ≤ z < 1', (z) => z >= 0 && z < 1],
  ['1 ≤ z < 2', (z) => z >= 1 && z < 2],
  ['z ≥ 2', (z) => z >= 2],
];
console.log(`${padE('ticker', 7)}${padE('bucket', 14)}${pad('n', 6)}${pad('open→10:30', 13)}${pad('t', 7)}${pad('09:31→10:30', 13)}${pad('t', 7)}`);
for (const t of TICKERS) {
  for (const [name, f] of BUCKETS) {
    const ds = data[t].days.filter((d) => f(d.z));
    const a = ds.map((d) => -Math.sign(d.gap) * (priceAt(d.s, 60) / d.s.O[0] - 1));
    const b = ds
      .map((d) => {
        const st = openAtOrAfter(d.s, 1, 5);
        return Number.isNaN(st) ? NaN : -Math.sign(d.gap) * (priceAt(d.s, 60) / st - 1);
      })
      .filter((x) => !Number.isNaN(x));
    console.log(
      `${padE(t, 7)}${padE(name, 14)}${pad(ds.length, 6)}${pad(bp(mean(a)), 13)}${pad(f2(tstat(a)), 7)}${pad(bp(mean(b)), 13)}${pad(f2(tstat(b)), 7)}`,
    );
  }
}

// --- Part 2: strategy --------------------------------------------------------------------------

const GRID = [
  { name: 'P   |z|≥1 · 09:31 · min(10:30, fill)', ...P, primary: true },
  { name: '2   entry 09:32', ...P, entryK: 2 },
  { name: '3   entry 09:35', ...P, entryK: 5 },
  { name: '4   |z|≥0.5', ...P, zth: 0.5 },
  { name: '5   |z|≥1.5', ...P, zth: 1.5 },
  { name: '6   |z|≥2', ...P, zth: 2 },
  { name: '7   exit 10:00', ...P, exitK: 30 },
  { name: '8   exit 11:00', ...P, exitK: 90 },
  { name: '9   exit 12:00', ...P, exitK: 150 },
  { name: '10  exit close', ...P, exitK: Infinity },
  { name: '11  10:30, no gap-fill exit', ...P, gapFill: false },
  { name: '12  no CPI/jobs/FOMC days', ...P, news: false },
  { name: '13  ex-div days dropped', ...P, div: 'drop' },
  { name: '14  MOO on 09:28 pre-market z', ...P, moo: true, entryK: 0 },
];

/** Returns trades [{date, year, ticker, side, gross, exitReason}] and eligible dates. */
function simulate(cfg) {
  const trades = [];
  const eligible = new Set();
  const skips = { noFill: 0, alreadyFilled: 0, noPre: 0 };
  for (const t of TICKERS) {
    for (const d of data[t].days) {
      if (!cfg.news && d.news) continue;
      if (cfg.div === 'drop' && d.exDiv) continue;
      eligible.add(d.date);
      const s = d.s;
      let zUse = d.z;
      if (cfg.moo) {
        if (Number.isNaN(s.pre)) {
          skips.noPre++;
          continue;
        }
        zUse = (s.pre / d.Cp - 1) / d.sd;
      }
      if (Math.abs(zUse) < cfg.zth) continue;
      const side = zUse > 0 ? -1 : 1; // fade
      let kE, entry;
      if (cfg.moo) {
        kE = 0;
        entry = s.O[0];
      } else {
        kE = firstBarAtOrAfter(s, cfg.entryK, 5);
        if (kE < 0) {
          skips.noFill++;
          continue;
        }
        entry = s.O[kE];
        const known = s.C[kE - 1]; // close of the bar before the fill bar
        if ((side === -1 && known <= d.Cp) || (side === 1 && known >= d.Cp)) {
          skips.alreadyFilled++;
          continue;
        }
      }
      const kX = Math.min(cfg.exitK, s.n);
      let exit = NaN,
        reason = 'time';
      if (cfg.gapFill) {
        for (let k = kE; k < kX; k++) {
          if (Number.isNaN(s.O[k])) continue;
          const hit = side === -1 ? s.L[k] <= d.Cp : s.H[k] >= d.Cp;
          if (hit) {
            const nx = priceAt(s, k + 1);
            exit = side === -1 ? Math.max(d.Cp, nx) : Math.min(d.Cp, nx);
            reason = 'fill';
            break;
          }
        }
      }
      if (Number.isNaN(exit)) exit = priceAt(s, kX);
      trades.push({
        date: d.date,
        year: d.year,
        ticker: t,
        side,
        gross: side * (exit / entry - 1),
        reason,
      });
    }
  }
  return { trades, eligible: [...eligible].sort(), skips };
}

function evaluate(sim, cost, filter = () => true) {
  const trades = sim.trades.filter(filter);
  const net = (tr) => tr.gross - 2 * COSTS[cost];
  const byDate = new Map();
  for (const tr of trades) {
    const a = byDate.get(tr.date) ?? [];
    a.push(net(tr));
    byDate.set(tr.date, a);
  }
  const dayMeans = [...byDate.values()].map(mean);
  const portfolio = sim.eligible.map((dt) => (byDate.get(dt) ?? []).reduce((a, b) => a + b, 0) / TICKERS.length);
  const ps = portfolioStats(portfolio);
  const sortedDays = [...portfolio].sort((a, b) => b - a).slice(5);
  const years = sim.eligible.length / 252;
  const nets = trades.map(net);
  // without the 5 best days: drop those dates' trades from the trade-level stats too
  const best5 = new Set(
    sim.eligible
      .map((dt, i) => [dt, portfolio[i]])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map((x) => x[0]),
  );
  const dm5 = [...byDate.entries()].filter(([dt]) => !best5.has(dt)).map(([, a]) => mean(a));
  return {
    n: trades.length,
    perYear: trades.length / years,
    hit: nets.filter((x) => x > 0).length / nets.length,
    avg: mean(nets),
    tDay: tstat(dayMeans),
    sharpe: ps.sharpe,
    mdd: ps.mdd,
    worst: ps.worst,
    total: ps.total,
    annual: ps.mean * 252,
    w5avg: mean(dm5),
    w5t: tstat(dm5),
    w5sharpe: portfolioStats(sortedDays).sharpe,
    fillShare: trades.filter((t) => t.reason === 'fill').length / trades.length,
  };
}

const header =
  `${padE('', 40)}${pad('trades', 7)}${pad('/yr', 6)}${pad('hit', 6)}${pad('avg bp', 8)}${pad('t(day)', 8)}` +
  `${pad('Sharpe', 8)}${pad('ann.', 8)}${pad('maxDD', 8)}${pad('worst', 8)}${pad('fill%', 7)}${pad('w/o5 avg', 10)}${pad('t', 6)}`;
const row = (label, e) =>
  `${padE(label, 40)}${pad(e.n, 7)}${pad(e.perYear.toFixed(1), 6)}${pad(pct(e.hit, 0), 6)}${pad(bp(e.avg), 8)}${pad(f2(e.tDay), 8)}` +
  `${pad(f2(e.sharpe), 8)}${pad(pct(e.annual), 8)}${pad(pct(e.mdd), 8)}${pad(pct(e.worst, 2), 8)}${pad(pct(e.fillShare, 0), 7)}${pad(bp(e.w5avg), 10)}${pad(f2(e.w5t), 6)}`;

console.log('\n# Part 2 — strategy\n');
console.log('Portfolio = 1/3 of capital per ticker, 1× notional per trade; Sharpe/ann./maxDD/worst on daily portfolio returns');
console.log('(all eligible days); avg bp and hit per trade; t(day) = t across dates of the mean trade that date.');

const sims = GRID.map((cfg) => ({ cfg, sim: simulate(cfg) }));
const primary = sims[0];

console.log(`\n## Primary P: ${primary.cfg.name}`);
console.log(`skips: ${JSON.stringify(primary.sim.skips)}\n`);
for (const cost of Object.keys(COSTS)) {
  console.log(`### cost ${cost} (${Math.round(COSTS[cost] * 1e4)} bp per side)`);
  console.log(header);
  console.log(row('long-short, all tickers', evaluate(primary.sim, cost)));
  console.log(row('long-only (fade gap downs)', evaluate(primary.sim, cost, (t) => t.side === 1)));
  console.log(row('short-only (fade gap ups)', evaluate(primary.sim, cost, (t) => t.side === -1)));
  for (const tk of TICKERS) {
    console.log(row(`${tk} long-short`, evaluate(primary.sim, cost, (t) => t.ticker === tk)));
    console.log(row(`${tk} long-only`, evaluate(primary.sim, cost, (t) => t.ticker === tk && t.side === 1)));
    console.log(row(`${tk} short-only`, evaluate(primary.sim, cost, (t) => t.ticker === tk && t.side === -1)));
  }
  console.log('');
}

function yearTable(sim, cost) {
  console.log(`${padE('year', 6)}${pad('trades', 7)}${pad('sum %', 8)}${pad('avg bp', 8)}${pad('t', 7)}${TICKERS.map((t) => pad(`${t} avg`, 9)).join('')}${pad('long avg', 10)}${pad('short avg', 10)}`);
  const out = {};
  for (const y of YEARS) {
    const tr = sim.trades.filter((t) => t.year === y);
    const nets = tr.map((t) => t.gross - 2 * COSTS[cost]);
    const byDate = new Map();
    tr.forEach((t, i) => byDate.set(t.date, [...(byDate.get(t.date) ?? []), nets[i]]));
    const sum = nets.reduce((a, b) => a + b, 0) / TICKERS.length;
    out[y] = sum;
    const tk = TICKERS.map((k) => {
      const a = tr.filter((t) => t.ticker === k).map((t) => t.gross - 2 * COSTS[cost]);
      return pad(a.length ? bp(mean(a)) : '—', 9);
    });
    const l = tr.filter((t) => t.side === 1).map((t) => t.gross - 2 * COSTS[cost]);
    const s = tr.filter((t) => t.side === -1).map((t) => t.gross - 2 * COSTS[cost]);
    console.log(
      `${padE(y, 6)}${pad(tr.length, 7)}${pad(pct(sum), 8)}${pad(bp(mean(nets)), 8)}${pad(f2(tstat([...byDate.values()].map(mean))), 7)}${tk.join('')}${pad(bp(mean(l)), 10)}${pad(bp(mean(s)), 10)}`,
    );
  }
  return out;
}

console.log('## P by year, primary costs (sum % = portfolio return, summed)');
const yearsPrimary = yearTable(primary.sim, 'primary');
console.log('\n## P by year, zero cost');
yearTable(primary.sim, 'zero');

console.log('\n## Grid (14 configs; information only except P and config 2, which is in the pass rule)\n');
for (const cost of Object.keys(COSTS)) {
  console.log(`### cost ${cost}`);
  console.log(header + TICKERS.map((t) => pad(`${t}`, 7)).join(''));
  for (const { cfg, sim } of sims) {
    const e = evaluate(sim, cost);
    const tk = TICKERS.map((k) => pad(bp(evaluate(sim, cost, (t) => t.ticker === k).avg), 7));
    console.log(row(cfg.name, e) + tk.join(''));
  }
  console.log('');
}
console.log('Long-only (fade gap downs) slice of each config, primary costs:');
console.log(header);
for (const { cfg, sim } of sims) console.log(row(cfg.name, evaluate(sim, 'primary', (t) => t.side === 1)));

// --- pass rule ---------------------------------------------------------------------------------

console.log('\n# Pass rule\n');
const reg = Object.fromEntries(TICKERS.map((t) => [t, regRows(data[t].days, 0)['10:30']]));
const E1 = reg.SPY.b < 0 && reg.SPY.tHC <= -2.5;
const E2 = reg.QQQ.b < 0 && reg.IWM.b < 0;
console.log(`E1 SPY open→10:30 slope ${f2(reg.SPY.b)}, HC1 t ${f2(reg.SPY.tHC)} (needs < 0, t ≤ −2.5): ${E1 ? 'PASS' : 'FAIL'}`);
console.log(`E2 QQQ ${f2(reg.QQQ.b)} [${f2(reg.QQQ.tHC)}], IWM ${f2(reg.IWM.b)} [${f2(reg.IWM.tHC)}] (both < 0): ${E2 ? 'PASS' : 'FAIL'}`);
const eP = evaluate(primary.sim, 'primary');
const W1 = eP.avg > 0 && eP.tDay >= 2;
const fullYears = YEARS.filter((y) => y >= '2016' && y <= '2025');
const posYears = fullYears.filter((y) => yearsPrimary[y] > 0).length;
const W2 = posYears >= 7;
const e2 = evaluate(sims[1].sim, 'primary');
const W3 = e2.avg > 0;
const posTk = TICKERS.filter((k) => evaluate(primary.sim, 'primary', (t) => t.ticker === k).avg > 0);
const W4 = posTk.length >= 2;
console.log(`W1 P avg trade ${bp(eP.avg)} bp, day t ${f2(eP.tDay)} (needs > 0, t ≥ 2): ${W1 ? 'PASS' : 'FAIL'}`);
console.log(`W2 positive years 2016–2025: ${posYears}/10 (needs ≥ 7): ${W2 ? 'PASS' : 'FAIL'}`);
console.log(`W3 entry 09:32 avg trade ${bp(e2.avg)} bp (needs > 0): ${W3 ? 'PASS' : 'FAIL'}`);
console.log(`W4 tickers with avg > 0: ${posTk.join(', ') || 'none'} (needs ≥ 2): ${W4 ? 'PASS' : 'FAIL'}`);
const E = E1 && E2,
  W = W1 && W2 && W3 && W4;
console.log(`\nVerdict: ${E && W ? 'PASS' : E ? 'EFFECT EXISTS, NOT WORTH TRADING' : 'FAIL (effect not shown)'} (E ${E ? 'pass' : 'fail'}, W ${W ? 'pass' : 'fail'})`);

// --- slow-path check ---------------------------------------------------------------------------

function runCheck(ticker, date) {
  const rec = data[ticker].days.find((d) => d.date === date);
  const ci = calendar.findIndex((d) => d.date === date);
  const prevDay = calendar[ci - 1];
  const bars = JSON.parse(readFileSync(`${dataDir}/stocks/${ticker}/${date}.json`, 'utf8'));
  const pbars = JSON.parse(readFileSync(`${dataDir}/stocks/${ticker}/${prevDay.date}.json`, 'utf8'));
  const at = (bs, day, hm) =>
    bs.find((b) => fmt.format(Date.parse(b.t)) === hm && new Date(Date.parse(b.t)).toISOString().slice(0, 10) <= day);
  const closeHm = prevDay.close;
  const pc = at(pbars, prevDay.date, closeHm);
  const op = at(bars, date, '09:30');
  const b931 = at(bars, date, '09:31');
  const b1030 = at(bars, date, '10:30');
  const daily = loadDaily(ticker);
  console.log(`slow path ${ticker} ${date}: prev ${prevDay.date} ${closeHm} bar open ${pc?.o}, 09:30 open ${op?.o}, 09:31 open ${b931?.o}, 10:30 open ${b1030?.o}`);
  const fT = daily.get(date).c / at(bars, date, calendar[ci].close).o;
  const fP = daily.get(prevDay.date).c / pc.o;
  console.log(`  factor jump ${bp(1 - fP / fT, 2)} bp → ${1 - fP / fT > DIV_MIN ? 'ex-div' : 'no dividend'}; raw gap ${pct(op.o / pc.o - 1, 3)}`);
  console.log(`  open→10:30 ${pct(b1030.o / op.o - 1, 3)}, 09:31→10:30 ${pct(b1030.o / b931.o - 1, 3)}`);
  if (rec) {
    console.log(`fast path: Cp ${rec.Cp.toFixed(4)}, gap ${pct(rec.gap, 3)}, sd ${pct(rec.sd, 3)}, z ${f2(rec.z)}, exDiv ${rec.exDiv}, news ${rec.news}`);
    const tr = simulate(P).trades.find((t) => t.date === date && t.ticker === ticker);
    console.log(`  primary trade: ${tr ? `side ${tr.side}, gross ${bp(tr.gross)} bp, exit ${tr.reason}` : 'none'}`);
    // independent sd: last 20 valid gaps before today from the fast-path list
    const i = data[ticker].days.findIndex((d) => d.date === date);
    console.log(`  previous gap days used for sd start at ${data[ticker].days[Math.max(0, i - SD_N)]?.date} (approx; sd uses all valid gaps, including sd-not-ready days)`);
  } else console.log('fast path: no record (skipped day)');
}
