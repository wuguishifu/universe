// H13 step 3: the 5-minute ORB on "stocks in play" (Zarattini, Barbon & Aziz 2024), the backtest.
// Design and pass rule: research/hypotheses/h13.md (pre-registered before this ran).
//
// usage:
//   node --max-old-space-size=16000 research/tools/h13-orb.mjs <cacheDir> [dataDir]
//   node ... h13-orb.mjs <cacheDir> [dataDir] --check AAPL 2020-03-04   one stock-day, verbose
// needs <cacheDir>/universe.json (h13-universe.mjs) and picks-<YEAR>.json (h13-picks.mjs), plus the
// full-day minute files. Days whose full-day files aren't downloaded yet are left out (counted).
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const cacheDir = args[0];
const dataDir = args[1] && !args[1].startsWith('--') ? args[1] : 'data';
const ci = args.indexOf('--check');
const CHECK = ci >= 0 ? { t: args[ci + 1], date: args[ci + 2] } : null;

const PAPER_END = '2023-12-29';
const POST_START = '2024-02-01';
const DELISTED_BEFORE = '2026-11-06';
const COSTS = { zero: [0, 0], primary: [2e-4, 5e-4], stress: [5e-4, 15e-4] }; // [rank<=500, 501-1000] per side
const BORROW = 0.005 / 252;
const MAX_WAIT = 4; // entry bar may start up to 4 minutes after the intended minute (09:35 → 09:39)
const RISK = 0.01;
const MAX_LEV = 4;
const FIN_SPREAD = 0.02;

const U = JSON.parse(readFileSync(`${cacheDir}/universe.json`, 'utf8'));
const PK = { picks: {}, stats: {}, gapDays: [] };
for (const f of readdirSync(cacheDir).filter((f) => /^picks-\d{4}\.json$/.test(f)).sort()) {
  const x = JSON.parse(readFileSync(`${cacheDir}/${f}`, 'utf8'));
  PK.fields = x.fields;
  Object.assign(PK.picks, x.picks);
  Object.assign(PK.stats, x.stats);
  PK.gapDays.push(...x.gapDays);
}
const cal = new Map(JSON.parse(readFileSync(`${dataDir}/calendar.json`, 'utf8')).map((d) => [d.date, d]));
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const nyMidnight = (date) => {
  const noonUtc = Date.parse(`${date}T17:00:00Z`);
  const [h, m] = fmt.format(noonUtc).split(':').map(Number);
  return noonUtc - (h * 60 + m) * 60_000;
};
const clock = (k, open = 570) => `${String(Math.floor((open + k) / 60)).padStart(2, '0')}:${String((open + k) % 60).padStart(2, '0')}`;
const barDate = (t) => new Date(Date.parse(t) + 12 * 3600_000).toISOString().slice(0, 10);

const rawCache = new Map();
function rawDaily(t) {
  if (!rawCache.has(t)) {
    const p = `${dataDir}/daily-raw/${t}.json`;
    const m = new Map();
    if (existsSync(p)) for (const b of JSON.parse(readFileSync(p, 'utf8'))) m.set(barDate(b.t), b);
    rawCache.set(t, m);
  }
  return rawCache.get(t);
}

// BIL financing rate known before each day
const finRate = new Map();
{
  const bil = JSON.parse(readFileSync(`${dataDir}/daily/BIL.json`, 'utf8')).map((b) => [barDate(b.t), b.c]);
  const rets = [];
  for (let i = 0; i < bil.length; i++) {
    const w = rets.slice(-21);
    const y = w.length ? Math.max(0, (w.reduce((a, b) => a + b, 0) / w.length) * 252) : 0;
    finRate.set(bil[i][0], y + FIN_SPREAD);
    if (i > 0) rets.push(bil[i][1] / bil[i - 1][1] - 1);
  }
}

// --- one session of minute bars --------------------------------------------------------------
function loadSession(t, date) {
  const p = `${dataDir}/stocks/${t}/${date}.json`;
  if (!existsSync(p)) return { missing: true };
  const bars = JSON.parse(readFileSync(p, 'utf8'));
  const day = cal.get(date);
  const open = hhmm(day.open);
  const n = hhmm(day.close) - open;
  const midnight = nyMidnight(date);
  const O = new Float64Array(n).fill(NaN),
    H = new Float64Array(n).fill(NaN),
    L = new Float64Array(n).fill(NaN),
    C = new Float64Array(n).fill(NaN);
  let nb = 0;
  for (const b of bars) {
    const k = (Date.parse(b.t) - midnight) / 60_000 - open;
    if (k >= 0 && k < n) {
      O[k] = b.o;
      H[k] = b.h;
      L[k] = b.l;
      C[k] = b.c;
      nb++;
    }
  }
  if (!nb) return { empty: true };
  let lastC = NaN;
  for (let k = n - 1; k >= 0; k--)
    if (!Number.isNaN(C[k])) {
      lastC = C[k];
      break;
    }
  const d = rawDaily(t).get(date);
  return { n, O, H, L, C, lastC, offClose: d ? d.c : NaN };
}

// --- configs ---------------------------------------------------------------------------------
const P = { name: 'P', top: 20, minRv: 1, stop: 0.1, entryK: 5, sides: 'both', openSrc: 'official', entry: 'market' };
const CONFIGS = [
  P,
  { ...P, name: '2 entry 09:36', entryK: 6 },
  { ...P, name: '3 top 10', top: 10 },
  { ...P, name: '4 top 50', top: 50 },
  { ...P, name: '5 RV >= 2', minRv: 2 },
  { ...P, name: '6 stop 5% ATR', stop: 0.05 },
  { ...P, name: '7 stop 20% ATR', stop: 0.2 },
  { ...P, name: '8 no stop', stop: null },
  { ...P, name: '9 long only', sides: 'long' },
  { ...P, name: '10 stop-order entry', entry: 'stop' },
  { ...P, name: '11 09:30-bar open', openSrc: 'bar' },
  // added after the 2016-2017 partial run (dated note 3), diagnostic: config 10 with the stop checked only
  // from the bar after the fill (config 10 assumes the worst order inside the fill bar)
  { ...P, name: '10b stop-order, stop from next bar (diag)', entry: 'stop', stopFromNext: true },
];
const F = Object.fromEntries(PK.fields.map((f, i) => [f, i]));

// Dated note 2: Alpaca serves a renamed company's history under its current symbol too (HCP's bars also
// appear as DOC, BK's as BNY), so the same security can be picked twice and the old ticker's full-day file
// comes back empty. Picks with an identical first candle (volume, close, 09:30 open) are one security: keep
// the ticker whose daily bars run latest (the current symbol, which carries the minute data).
const NODEDUP = process.env.H13_NODEDUP === '1';
function dedupe(rows) {
  if (NODEDUP) return rows;
  const best = new Map();
  for (const r of rows) {
    const k = `${r[F.v5]}|${r[F.c934]}|${r[F.o930]}`;
    const b = best.get(k);
    if (!b || (U.lastBar[r[0]] ?? '') > (U.lastBar[b[0]] ?? '')) best.set(k, r);
  }
  return rows.filter((r) => best.get(`${r[F.v5]}|${r[F.c934]}|${r[F.o930]}`) === r);
}
function select(rows0, cfg) {
  const rows = dedupe(rows0);
  const out = [];
  for (const r of rows) {
    if (r[F.rv] < cfg.minRv) continue;
    if (out.length >= cfg.top) break;
    out.push(r);
  }
  // direction, doji
  const trades = [];
  let doji = 0;
  for (const r of out) {
    const o = cfg.openSrc === 'official' && Number.isFinite(r[F.offOpen]) ? r[F.offOpen] : r[F.o930];
    if (!Number.isFinite(o)) continue;
    const dc = Math.round(r[F.c934] * 100) - Math.round(o * 100);
    if (dc === 0) {
      doji++;
      continue;
    }
    const side = dc > 0 ? 1 : -1;
    if (cfg.sides === 'long' && side < 0) continue;
    trades.push({ r, side });
  }
  return { trades, doji, n: out.length };
}

function simulate(s, pick, side, cfg, log) {
  const atr = pick[F.atr];
  let entryK = -1,
    entry = NaN;
  if (cfg.entry === 'market') {
    for (let k = cfg.entryK; k < s.n && k <= cfg.entryK + MAX_WAIT; k++)
      if (!Number.isNaN(s.O[k])) {
        entryK = k;
        entry = s.O[k];
        break;
      }
    if (entryK < 0) return { skip: 'no entry bar' };
    if (Math.abs(entry / pick[F.c934] - 1) > 0.2) return { skip: 'entry > 20% from candle close (bad print guard)' };
  } else {
    const trig = side > 0 ? pick[F.h5] : pick[F.l5];
    for (let k = cfg.entryK; k < s.n; k++) {
      if (Number.isNaN(s.O[k])) continue;
      if (side > 0 ? s.H[k] >= trig : s.L[k] <= trig) {
        entryK = k;
        entry = side > 0 ? Math.max(trig, s.O[k]) : Math.min(trig, s.O[k]);
        break;
      }
    }
    if (entryK < 0) return { skip: 'never triggered' };
    if (Math.abs(entry / pick[F.c934] - 1) > 0.2) return { skip: 'entry > 20% from candle close (bad print guard)' };
  }
  const dist = cfg.stop == null ? NaN : cfg.stop * atr;
  const stop = entry - side * dist;
  log?.(`entry ${clock(entryK)} at ${entry}; ATR ${atr}; stop ${cfg.stop == null ? 'none' : stop.toFixed(4)}`);
  let exit = NaN,
    exitType = 'close',
    exitK = s.n;
  if (cfg.stop != null)
    for (let k = cfg.stopFromNext ? entryK + 1 : entryK; k < s.n; k++) {
      if (Number.isNaN(s.O[k])) continue;
      if (side > 0 ? s.L[k] <= stop : s.H[k] >= stop) {
        // on the entry bar of a stop-order entry the open is before the fill: fill at the stop
        const o = k === entryK ? (cfg.entry === 'stop' ? stop : s.O[k]) : s.O[k];
        exit = side > 0 ? Math.min(stop, o) : Math.max(stop, o);
        exitType = 'stop';
        exitK = k;
        break;
      }
    }
  if (exitType === 'close') {
    if (Number.isFinite(s.offClose)) exit = s.offClose;
    else {
      exit = s.lastC;
      exitType = 'close(last bar)';
    }
  }
  log?.(`exit ${exitType} at ${exitK < s.n ? clock(exitK) : 'close'}: ${exit}`);
  return { entry, exit, exitType, entryK, exitK, gross: side * (exit / entry - 1), stopFrac: dist / entry };
}

// --- check mode --------------------------------------------------------------------------------
if (CHECK) {
  const { t, date } = CHECK;
  const c = U.cand[date]?.find((x) => x[0] === t);
  console.log(`universe entry [ticker, rank, ATR14, ADV14, f_d, prevC, offOpen]: ${JSON.stringify(c)}`);
  const rows = PK.picks[date] ?? [];
  const pos = rows.findIndex((r) => r[0] === t);
  console.log(`RV rank among RV>=1 that day: ${pos + 1} of ${rows.length} kept (${PK.stats[date] ? JSON.stringify(PK.stats[date]) : 'no stats'})`);
  if (pos >= 0) console.log(`row ${JSON.stringify(Object.fromEntries(PK.fields.map((f, i) => [f, rows[pos][i]])))}`);
  const sel = select(rows, P);
  const tr = sel.trades.find((x) => x.r[0] === t);
  console.log(`selected by P: ${tr ? (tr.side > 0 ? 'LONG' : 'SHORT') : 'no'}`);
  const s = loadSession(t, date);
  if (s.n) {
    for (let k = 0; k < 12; k++) console.log(`  ${clock(k)} o ${s.O[k]} h ${s.H[k]} l ${s.L[k]} c ${s.C[k]}`);
    if (tr) {
      const res = simulate(s, tr.r, tr.side, P, console.log);
      console.log(`gross ${(res.gross * 1e4).toFixed(1)} bp; official close ${s.offClose}, last bar close ${s.lastC}`);
    }
  } else console.log('no full-day minute file', s);
  process.exit(0);
}

// --- run all configs -----------------------------------------------------------------------------
const dates = Object.keys(PK.picks).sort();
const sessCache = new Map(); // per date, reused across configs
const results = {}; // cfg -> { days: [{date, trades:[...]}] }
const skips = {};
let daysNotDownloaded = 0;
const usable = [];
for (const d of dates) {
  const rows = PK.picks[d];
  const have = rows.filter((r) => existsSync(`${dataDir}/stocks/${r[0]}/${d}.json`)).length;
  if (rows.length && have < 0.9 * rows.length) {
    daysNotDownloaded++;
    continue;
  }
  usable.push(d);
}
for (const cfg of CONFIGS) {
  results[cfg.name] = [];
  skips[cfg.name] = {};
}
const bump = (c, k) => (skips[c][k] = (skips[c][k] ?? 0) + 1);
for (const d of usable) {
  const rows = PK.picks[d];
  const sess = new Map();
  for (const cfg of CONFIGS) {
    const { trades, doji } = select(rows, cfg);
    for (let i = 0; i < doji; i++) bump(cfg.name, 'doji');
    const out = [];
    for (const { r, side } of trades) {
      const t = r[0];
      if (!sess.has(t)) sess.set(t, loadSession(t, d));
      const s = sess.get(t);
      if (s.missing) {
        bump(cfg.name, 'no full-day file');
        continue;
      }
      if (s.empty) {
        bump(cfg.name, 'no minute bars');
        continue;
      }
      const res = simulate(s, r, side, cfg);
      if (res.skip) {
        bump(cfg.name, res.skip);
        continue;
      }
      if (res.exitType === 'close(last bar)') bump(cfg.name, 'close from last bar');
      out.push({
        t,
        side,
        tier: r[F.rank] <= 500 ? 0 : 1,
        delisted: (U.lastBar[t] ?? '') < DELISTED_BEFORE,
        ...res,
      });
    }
    results[cfg.name].push({ date: d, trades: out });
  }
}

// --- statistics ------------------------------------------------------------------------------
const netRet = (tr, cost) => tr.gross - 2 * COSTS[cost][tr.tier] - (tr.side < 0 ? BORROW : 0);
function series(days, cost, filt = () => true, from = '0', to = '9') {
  const out = [];
  for (const { date, trades } of days) {
    if (date < from || date > to) continue;
    const ts = trades.filter(filt);
    out.push({ date, r: ts.length ? ts.reduce((a, x) => a + netRet(x, cost), 0) / ts.length : 0, n: ts.length, ts });
  }
  return out;
}
function stats(s) {
  const r = s.map((x) => x.r);
  const n = r.length;
  if (!n) return null;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  let eq = 1,
    pk = 1,
    dd = 0;
  for (const x of r) {
    eq *= 1 + x;
    pk = Math.max(pk, eq);
    dd = Math.min(dd, eq / pk - 1);
  }
  const sorted = [...r].sort((a, b) => b - a);
  const rest = sorted.slice(5);
  const m5 = rest.reduce((a, b) => a + b, 0) / rest.length;
  const sd5 = Math.sqrt(rest.reduce((a, b) => a + (b - m5) ** 2, 0) / (rest.length - 1));
  const trades = s.flatMap((x) => x.ts);
  return {
    days: n,
    trades: trades.length,
    tpd: trades.length / n,
    mean,
    t: mean / (sd / Math.sqrt(n)),
    sharpe: (mean / sd) * Math.sqrt(252),
    cagr: eq ** (252 / n) - 1,
    dd,
    worst: sorted.at(-1),
    t5: m5 / (sd5 / Math.sqrt(rest.length)),
  };
}
const tradeStats = (trades, cost) => {
  const r = trades.map((x) => netRet(x, cost));
  const n = r.length;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  return { n, mean, hit: r.filter((x) => x > 0).length / n };
};
const bp = (x, d = 1) => (Number.isFinite(x) ? (x * 1e4).toFixed(d) : 'n/a');
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
// samples (not sizing): the paper's sample period and after publication; paper SIZING is its own table below
const SAMPLES = {
  'full 2016-2026': ['0', '9'],
  'paper sample 2016-2023': ['0', PAPER_END],
  'post-publication 2024-02+': [POST_START, '9'],
};
const line = (label, st, ts) =>
  !st ? `| ${label} | no days |` : `| ${label} | ${st.trades} | ${f2(st.tpd)} | ${pct(ts.hit, 0)} | ${bp(ts.mean)} | ${bp(st.mean, 2)} | ${f2(st.t)} | ${f2(st.sharpe)} | ${pct(st.cagr)} | ${pct(st.dd)} | ${pct(st.worst, 2)} | ${f2(st.t5)} |`;
const HEAD = `| Slice | Trades | /day | Hit | Avg trade bp | Daily mean bp | t (daily) | Sharpe | CAGR | Max DD | Worst day | t w/o 5 best |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`;

console.log(`H13 ORB on stocks in play — ${usable.length} days with picks and full-day data (${usable[0]} → ${usable.at(-1)}); ${daysNotDownloaded} days with picks but no full-day files yet; gap days ${PK.gapDays.length}`);
console.log('');
console.log('## Skips per config (picks not traded)');
for (const c of CONFIGS) console.log(`${c.name}: ${JSON.stringify(skips[c.name])}`);

const days = results.P;
const allP = days.flatMap((x) => x.trades);
console.log('');
console.log('## Primary: P at 1x gross, equal split across the day\'s trades (rows = sample period x cost level)');
console.log(HEAD);
for (const [sn, [a, b]] of Object.entries(SAMPLES))
  for (const cost of ['zero', 'primary', 'stress']) {
    const s = series(days, cost, undefined, a, b);
    if (!s.length) continue;
    console.log(line(`${sn} ${cost}`, stats(s), tradeStats(s.flatMap((x) => x.ts), cost)));
  }

console.log('');
console.log('## P slices (primary costs unless noted; per-trade averages, daily t on the slice alone)');
console.log(HEAD);
const slices = [
  ['long', (x) => x.side > 0],
  ['short', (x) => x.side < 0],
  ['top 500', (x) => x.tier === 0],
  ['rank 501-1000', (x) => x.tier === 1],
  ['now delisted', (x) => x.delisted],
  ['still listed (survivor-biased)', (x) => !x.delisted],
];
for (const [name, fl] of slices)
  for (const cost of ['zero', 'primary']) {
    const s = series(days, cost, fl);
    const sd = s.filter((x) => x.n > 0);
    console.log(line(`${name} ${cost} (days with a trade: ${sd.length})`, stats(s), tradeStats(s.flatMap((x) => x.ts), cost)));
  }
for (const [name, fl] of [['all', () => true], ['top 500', (x) => x.tier === 0], ['rank 501-1000', (x) => x.tier === 1]]) {
  const tr = allP.filter(fl);
  const g = tr.reduce((a, x) => a + x.gross, 0) / tr.length;
  console.log(`break-even cost per side, ${name}: ${bp(g / 2, 2)} bp (avg gross ${bp(g, 2)} bp over ${tr.length} trades)`);
}
console.log(`now-delisted picks: ${allP.filter((x) => x.delisted).length} of ${allP.length} (${pct(allP.filter((x) => x.delisted).length / allP.length)}); distinct tickers ${new Set(allP.map((x) => x.t)).size}, now delisted ${new Set(allP.filter((x) => x.delisted).map((x) => x.t)).size}`);

console.log('');
console.log('## Exits (P)');
const ex = {};
for (const x of allP) {
  ex[x.exitType] ??= [];
  ex[x.exitType].push(x.gross);
}
for (const [k, v] of Object.entries(ex)) console.log(`${k}: ${v.length} (${pct(v.length / allP.length)}), avg gross ${bp(v.reduce((a, b) => a + b, 0) / v.length)} bp`);
const sf = allP.map((x) => x.stopFrac).sort((a, b) => a - b);
console.log(`stop distance as % of entry: median ${pct(sf[Math.floor(sf.length / 2)], 2)}, p10 ${pct(sf[Math.floor(sf.length * 0.1)], 2)}, p90 ${pct(sf[Math.floor(sf.length * 0.9)], 2)}`);
const absMove = allP.filter((x) => x.exitType === 'close').map((x) => Math.abs(x.gross)).sort((a, b) => a - b);
console.log(`|entry→close| on trades held to the close: median ${bp(absMove[Math.floor(absMove.length / 2)])} bp`);

console.log('');
console.log('## P per year (1x): daily-mean-sum = sum of daily returns');
console.log('| Year | Days | Trades | Avg trade bp (0 / primary / stress) | Sum primary | t primary | Sum zero |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
const years = [...new Set(usable.map((d) => d.slice(0, 4)))];
const yearPos = {};
for (const y of years) {
  const sp = series(days, 'primary', undefined, `${y}-01-01`, `${y}-12-31`);
  const sz = series(days, 'zero', undefined, `${y}-01-01`, `${y}-12-31`);
  const ss = series(days, 'stress', undefined, `${y}-01-01`, `${y}-12-31`);
  const tr = sp.flatMap((x) => x.ts);
  const st = stats(sp);
  const sum = sp.reduce((a, x) => a + x.r, 0);
  yearPos[y] = sum;
  console.log(
    `| ${y} | ${sp.length} | ${tr.length} | ${bp(tradeStats(tr, 'zero').mean)} / ${bp(tradeStats(tr, 'primary').mean)} / ${bp(tradeStats(tr, 'stress').mean)} | ${pct(sum)} | ${f2(st.t)} | ${pct(sz.reduce((a, x) => a + x.r, 0))} |`,
  );
  void ss;
}

// paper sizing
console.log('');
console.log('## Paper sizing (P): 1% risk per trade at the stop, book scaled to <= 4x gross');
console.log('| Sample | Cost | Financing | Avg gross lev | CAGR | Sharpe | Max DD | Total |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [sn, [a, b]] of Object.entries(SAMPLES))
  for (const cost of ['zero', 'primary'])
    for (const fin of [false, true]) {
      let eq = 1,
        pk = 1,
        dd = 0,
        levs = 0,
        nl = 0;
      const r = [];
      for (const { date, trades } of days) {
        if (date < a || date > b) continue;
        let w = trades.map((x) => RISK / x.stopFrac);
        const sw = w.reduce((p, q) => p + q, 0);
        if (sw > MAX_LEV) w = w.map((x) => (x * MAX_LEV) / sw);
        const gross = w.reduce((p, q) => p + q, 0);
        if (trades.length) {
          levs += gross;
          nl++;
        }
        let d = trades.reduce((p, x, i) => p + w[i] * netRet(x, cost), 0);
        if (fin) d -= ((finRate.get(date) ?? FIN_SPREAD) / 252) * Math.max(gross - 1, 0);
        r.push(d);
        eq *= 1 + d;
        pk = Math.max(pk, eq);
        dd = Math.min(dd, eq / pk - 1);
      }
      if (!r.length) continue;
      const mean = r.reduce((p, q) => p + q, 0) / r.length;
      const sd = Math.sqrt(r.reduce((p, q) => p + (q - mean) ** 2, 0) / (r.length - 1));
      console.log(`| ${sn} | ${cost} | ${fin ? 'BIL+2%' : 'none'} | ${f2(levs / nl)} | ${pct(eq ** (252 / r.length) - 1)} | ${f2((mean / sd) * Math.sqrt(252))} | ${pct(dd)} | ${pct(eq - 1, 0)} |`);
    }

// grid
console.log('');
console.log('## Grid (1x): avg trade bp / daily t, at zero / primary / stress; full, paper sample, after publication');
console.log('| Config | Trades | Full 0 | Full primary | Full stress | Paper primary | Post primary | Sharpe full primary | Years + (of full 2016-2025) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
const cell = (dd, cost, a = '0', b = '9') => {
  const s = series(dd, cost, undefined, a, b);
  const st = stats(s);
  if (!st) return ['n/a', { sharpe: NaN }];
  return [`${bp(tradeStats(s.flatMap((x) => x.ts), cost).mean)} / ${f2(st.t)}`, st];
};
for (const c of CONFIGS) {
  const dd = results[c.name];
  const [z] = cell(dd, 'zero');
  const [p, st] = cell(dd, 'primary');
  const [s] = cell(dd, 'stress');
  const [pp] = cell(dd, 'primary', '0', PAPER_END);
  const [po] = cell(dd, 'primary', POST_START, '9');
  let yp = 0;
  for (let y = 2016; y <= 2025; y++) if (series(dd, 'primary', undefined, `${y}-01-01`, `${y}-12-31`).reduce((a, x) => a + x.r, 0) > 0) yp++;
  console.log(`| ${c.name} | ${dd.reduce((a, x) => a + x.trades.length, 0)} | ${z} | ${p} | ${s} | ${pp} | ${po} | ${f2(st.sharpe)} | ${yp} |`);
}

// pass rule
const stP = stats(series(days, 'primary'));
const y7 = Object.entries(yearPos).filter(([y, v]) => y >= '2016' && y <= '2025' && v > 0).length;
const m36 = stats(series(results['2 entry 09:36'], 'primary')).mean;
const mSt = stats(series(days, 'stress')).mean;
const mPost = stats(series(days, 'primary', undefined, POST_START, '9'))?.mean ?? NaN;
console.log('');
console.log('## Pass rule (P, 1x, primary costs)');
console.log(`1. full sample mean ${bp(stP.mean, 2)} bp/day, t ${f2(stP.t)} (needs > 0, t >= 2.5): ${stP.mean > 0 && stP.t >= 2.5 ? 'pass' : 'FAIL'}`);
console.log(`2. positive full years 2016-2025: ${y7} of 10 (needs 7): ${y7 >= 7 ? 'pass' : 'FAIL'}`);
console.log(`3. entry 09:36 mean ${bp(m36, 2)} bp/day (needs > 0): ${m36 > 0 ? 'pass' : 'FAIL'}`);
console.log(`4. stress costs mean ${bp(mSt, 2)} bp/day (needs > 0): ${mSt > 0 ? 'pass' : 'FAIL'}`);
console.log(`5. after publication mean ${bp(mPost, 2)} bp/day (needs > 0): ${mPost > 0 ? 'pass' : 'FAIL'}`);
const zPaper = stats(series(days, 'zero', undefined, '0', PAPER_END));
console.log(`replication (paper sample, zero cost, 1x): Sharpe ${f2(zPaper.sharpe)} (gate 1.5); paper-sizing CAGR: see the sizing table (gate 50%)`);

// --- post hoc (information only, added after the full run; dated note 4) ------------------------------
console.log('');
console.log('## Post hoc (information only): the top-500 slice, the only cell positive at primary cost');
console.log(HEAD);
for (const cname of ['P', '2 entry 09:36', '3 top 10'])
  for (const [sn, [a, b]] of Object.entries(SAMPLES))
    for (const cost of ['primary', 'stress']) {
      const s = series(results[cname], cost, (x) => x.tier === 0, a, b);
      console.log(line(`${cname} top-500 trades, ${sn}, ${cost}`, stats(s), tradeStats(s.flatMap((x) => x.ts), cost)));
    }
{
  const s = series(results.P, 'primary', (x) => x.tier === 0);
  let yp = 0;
  const ys = [];
  for (let y = 2016; y <= 2025; y++) {
    const v = s.filter((x) => x.date.startsWith(String(y))).reduce((p, x) => p + x.r, 0);
    ys.push(`${y} ${pct(v)}`);
    if (v > 0) yp++;
  }
  console.log(`P top-500 trades per year at 2 bp: ${ys.join(', ')}; positive ${yp} of 10`);
}
