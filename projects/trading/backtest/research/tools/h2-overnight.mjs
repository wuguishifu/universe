// H2: sell a defined-risk ATM straddle (iron butterfly) or strangle near the close, buy it back after
// the next open; plus the same-day mirror (09:45 -> 15:50). Design: research/hypotheses/h2.md.
//
// usage: node research/tools/h2-overnight.mjs [--sample=dev|holdout] [--confirm-holdout]
//          [--tickers=SPY,QQQ,IWM] [--from=YYYY-MM-DD --to=YYYY-MM-DD] [--debug=TICKER:DATE]
//          [--trades=<path.jsonl>] [--configs=primary|all]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DATA = new URL('../../data/', import.meta.url).pathname;
const sample = args.sample ?? 'dev';
if (sample === 'holdout' && !args['confirm-holdout']) {
  console.error('holdout needs --confirm-holdout (run once, on frozen candidates only)');
  process.exit(1);
}
const SAMPLE = {
  dev: { from: '2024-02-01', to: '2026-04-30' },
  holdout: { from: '2026-05-01', to: '2026-11-13' },
}[sample];
const from = args.from ?? SAMPLE.from;
const to = args.to ?? SAMPLE.to;
if (from < SAMPLE.from || to > SAMPLE.to) throw new Error('range outside sample');
const TICKERS = (args.tickers ?? 'SPY,QQQ,IWM').split(',');
const [debugTicker, debugDate] = args.debug ? args.debug.split(':') : [];

// ---------- costs ----------
const COSTS = {
  gross: { pct: 0, min: 0, fee: 0, round: false },
  primary: { pct: 0.01, min: 0.01, fee: 0.05, round: true },
  stress: { pct: 0.02, min: 0.01, fee: 0.05, round: true },
  harsh: { pct: 0.01, min: 0.04, fee: 0.05, round: true },
};
const fillPrice = (price, side, c) => {
  if (!c.round) return price;
  const h = Math.max(c.min, c.pct * price) / 2;
  const raw = side === 'buy' ? price + h : Math.max(0, price - h);
  const cents = raw * 100;
  const r = side === 'buy' ? Math.ceil(cents - 1e-9) : Math.floor(cents + 1e-9);
  return Math.max(0, r) / 100;
};

// ---------- time ----------
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const nyMinuteOf = (ms) => {
  const [h, m] = fmt.format(ms).split(':').map(Number);
  return h * 60 + m;
};
const hhmm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
/** UTC ms of NY wall-clock time `hm` on `date`. */
const nyMs = (date, hm) => {
  const [y, mo, d] = date.split('-').map(Number);
  const target = hhmm(hm);
  for (const off of [4, 5]) {
    const ms = Date.UTC(y, mo - 1, d, 0, 0) + (target + off * 60) * 60000;
    if (nyMinuteOf(ms) === target) return ms;
  }
  throw new Error(`bad time ${date} ${hm}`);
};
const MIN = 60000;
const addMin = (hm, n) => {
  const t = hhmm(hm) + n;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

// ---------- data ----------
const calendar = JSON.parse(readFileSync(`${DATA}/calendar.json`, 'utf8'));
const calIdx = new Map(calendar.map((d, i) => [d.date, i]));

class DayOptions {
  constructor(ticker, date) {
    const path = `${DATA}/options/${ticker}/${date}.json`;
    this.raw = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    this.empty = Object.keys(this.raw).length === 0;
    this.idx = new Map();
    this.expiries = new Set(Object.keys(this.raw).map((s) => s.slice(ticker.length, ticker.length + 6)));
  }
  has(sym) {
    return sym in this.raw;
  }
  sorted(sym) {
    let s = this.idx.get(sym);
    if (!s) {
      s = (this.raw[sym] ?? []).map((b) => ({ ms: Date.parse(b.t), o: b.o })).sort((a, b) => a.ms - b.ms);
      this.idx.set(sym, s);
    }
    return s;
  }
  /** Open of the first bar starting in [t, t + maxWait]. */
  firstIn(sym, t, maxWait = 5 * MIN) {
    for (const b of this.sorted(sym)) {
      if (b.ms < t) continue;
      if (b.ms > t + maxWait) return undefined;
      return b;
    }
    return undefined;
  }
  /** Open of the first bar starting at or after t (any time that day). */
  firstAfter(sym, t) {
    return this.sorted(sym).find((b) => b.ms >= t);
  }
}
class DayStock {
  constructor(ticker, date) {
    const path = `${DATA}/stocks/${ticker}/${date}.json`;
    this.bars = existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
          .map((b) => ({ ms: Date.parse(b.t), c: b.c }))
          .sort((a, b) => a.ms - b.ms)
      : [];
  }
  /** Close of the last bar starting before t (i.e. completed by t), within the session. */
  closeBefore(t, sessionOpenMs) {
    let last;
    for (const b of this.bars) {
      if (b.ms >= t) break;
      if (b.ms >= sessionOpenMs) last = b;
    }
    return last?.c;
  }
}

const yymmdd = (date) => date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
const occ = (t, exp, cp, k) => `${t}${yymmdd(exp)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;

// ---------- configs ----------
const CONFIGS = [];
for (const entry of ['15:30', '15:50'])
  for (const exit of ['09:35', '09:45', '10:00'])
    for (const w of [0.01, 0.015, 0.02])
      CONFIGS.push({ id: `ON fly ${entry}->${exit} w${w * 100}%`, kind: 'overnight', shape: 'fly', entry, exit, w });
for (const w of [0.01, 0.015, 0.02])
  CONFIGS.push({ id: `ON strangle 15:50->09:45 w${w * 100}%`, kind: 'overnight', shape: 'strangle', entry: '15:50', exit: '09:45', w });
for (const w of [0.01, 0.015, 0.02])
  CONFIGS.push({ id: `MIRROR fly 09:45->15:50 w${w * 100}%`, kind: 'mirror', shape: 'fly', entry: '09:45', exit: '15:50', w });
CONFIGS.push({ id: `MIRROR strangle 09:45->15:50 w1.5%`, kind: 'mirror', shape: 'strangle', entry: '09:45', exit: '15:50', w: 0.015 });
const PRIMARY = 'ON fly 15:50->09:45 w1.5%';
const runConfigs = args.configs === 'primary' ? CONFIGS.filter((c) => c.id === PRIMARY || c.id === 'MIRROR fly 09:45->15:50 w1.5%') : CONFIGS;

function legsFor(ticker, exp, shape, S, w) {
  const W = Math.max(1, Math.round(w * S));
  let kp, kc;
  if (shape === 'fly') kp = kc = Math.round(S);
  else {
    kp = Math.round(S * 0.995);
    kc = Math.round(S * 1.005);
  }
  return {
    W,
    legs: [
      { sym: occ(ticker, exp, 'P', kp), cp: 'P', k: kp, qty: -1 },
      { sym: occ(ticker, exp, 'C', kc), cp: 'C', k: kc, qty: -1 },
      { sym: occ(ticker, exp, 'P', kp - W), cp: 'P', k: kp - W, qty: 1 },
      { sym: occ(ticker, exp, 'C', kc + W), cp: 'C', k: kc + W, qty: 1 },
    ],
  };
}

/**
 * Simulates one structure. entryDay/exitDay: {date, opt, stk}. `laterDays`: days to keep working an
 * exit order on (in order), last one is expiry day for intrinsic settlement.
 */
function simulate(ticker, cfg, entryDay, exitDay, laterDays, expiryDay) {
  const entryT = nyMs(entryDay.date, cfg.entry);
  const S = entryDay.stk.closeBefore(entryT, nyMs(entryDay.date, '09:30'));
  if (S === undefined) return { status: 'no spot' };
  const { W, legs } = legsFor(ticker, expiryDay.date, cfg.shape, S, cfg.w);
  for (const leg of legs) {
    const b = entryDay.opt.firstIn(leg.sym, entryT);
    if (!b) return { status: 'entry unfilled', S, missing: leg.sym, inFile: entryDay.opt.has(leg.sym) };
    leg.entry = b.o;
    leg.entryMs = b.ms;
  }
  const exitT = nyMs(exitDay.date, cfg.exit);
  let stale = 0;
  let settled = 0;
  let absent = 0;
  for (const leg of legs) {
    if (!exitDay.opt.has(leg.sym)) {
      // Not downloaded: >= $10 outside the exit day's whole range. Close at intrinsic from the stock
      // at the exit time (dated note in h2.md), through the cost model.
      const spot = exitDay.stk.closeBefore(exitT, nyMs(exitDay.date, '09:30'));
      leg.exit = Math.max(0, leg.cp === 'C' ? spot - leg.k : leg.k - spot);
      leg.exitMs = exitT;
      leg.exitKind = 'absent from file';
      absent++;
      continue;
    }
    const b = exitDay.opt.firstIn(leg.sym, exitT);
    if (b) {
      leg.exit = b.o;
      leg.exitMs = b.ms;
      leg.exitKind = 'window';
      continue;
    }
    stale++;
    let found;
    for (const [i, d] of laterDays.entries()) {
      const after = i === 0 ? exitT : nyMs(d.date, '09:30');
      found = d.opt.firstAfter(leg.sym, after);
      if (found) break;
    }
    if (found) {
      leg.exit = found.o;
      leg.exitMs = found.ms;
      leg.exitKind = 'late';
    } else {
      const spot = expiryDay.stk.closeBefore(nyMs(expiryDay.date, '16:00'), nyMs(expiryDay.date, '09:30'));
      leg.exit = Math.max(0, leg.cp === 'C' ? spot - leg.k : leg.k - spot);
      leg.exitMs = nyMs(expiryDay.date, '16:00');
      leg.exitKind = 'settled';
      settled++;
    }
  }
  const pnl = {};
  const credit = {};
  const maxLoss = {};
  for (const [name, c] of Object.entries(COSTS)) {
    let cr = 0;
    let ex = 0;
    for (const leg of legs) {
      // qty -1: sell at entry, buy at exit; qty +1: buy at entry, sell at exit.
      if (leg.qty < 0) {
        cr += fillPrice(leg.entry, 'sell', c);
        ex -= fillPrice(leg.exit, 'buy', c);
      } else {
        cr -= fillPrice(leg.entry, 'buy', c);
        ex += fillPrice(leg.exit, 'sell', c);
      }
    }
    const fees = 8 * c.fee;
    pnl[name] = 100 * (cr + ex) - fees;
    credit[name] = 100 * cr - 4 * c.fee;
    maxLoss[name] = 100 * (W - cr) + fees;
  }
  return { status: 'ok', S, W, legs, pnl, credit, maxLoss, stale, settled, absent };
}

// ---------- main loop ----------
const days = calendar.filter((d) => d.date >= from && d.date <= to);
const trades = []; // {cfg, ticker, date, year, pnl, credit, maxLoss, stale, settled}
const counts = {}; // cfg -> {status -> n}
const bump = (cfg, k) => {
  counts[cfg] ??= {};
  counts[cfg][k] = (counts[cfg][k] ?? 0) + 1;
};

for (const ticker of TICKERS) {
  const cache = new Map();
  const get = (date) => {
    if (!cache.has(date)) {
      cache.set(date, { date, opt: new DayOptions(ticker, date), stk: new DayStock(ticker, date) });
      for (const k of cache.keys()) if (k < date && cache.size > 3) cache.delete(k);
    }
    return cache.get(date);
  };
  for (const d of days) {
    if (debugDate && d.date !== debugDate) continue;
    if (debugTicker && ticker !== debugTicker) continue;
    const eCal = calendar[calIdx.get(d.date) + 1];
    if (!eCal) continue;
    const D = get(d.date);
    const early = (c) => c.close !== '16:00' || c.open !== '09:30';
    for (const cfg of runConfigs) {
      const overnight = cfg.kind === 'overnight';
      if (eCal.date > to) continue; // night (or the mirror's expiry) would end outside the sample
      if (early(d) || (overnight && early(eCal))) {
        bump(cfg.id, 'early close');
        continue;
      }
      const E = get(eCal.date);
      if (D.opt.empty || (overnight && E.opt.empty)) {
        bump(cfg.id, 'no data');
        continue;
      }
      if (!D.opt.expiries.has(yymmdd(eCal.date))) {
        bump(cfg.id, 'no expiry');
        continue;
      }
      const r = overnight
        ? simulate(ticker, cfg, D, E, [E], E)
        : simulate(ticker, cfg, D, D, [D, E], E);
      bump(cfg.id, r.status);
      if (r.status !== 'ok') {
        if (debugDate) console.log(cfg.id, ticker, d.date, r);
        continue;
      }
      if (r.stale) bump(cfg.id, 'nights with stale exit leg');
      if (r.settled) bump(cfg.id, 'nights with a leg settled at expiry');
      counts[cfg.id]['stale legs'] = (counts[cfg.id]['stale legs'] ?? 0) + r.stale;
      counts[cfg.id]['legs settled at expiry'] = (counts[cfg.id]['legs settled at expiry'] ?? 0) + r.settled;
      counts[cfg.id]['legs absent from file'] = (counts[cfg.id]['legs absent from file'] ?? 0) + r.absent;
      if (r.absent) bump(cfg.id, 'nights with a leg absent from file');
      trades.push({ cfg: cfg.id, ticker, date: d.date, year: d.date.slice(0, 4), pnl: r.pnl, credit: r.credit, maxLoss: r.maxLoss, stale: r.stale, settled: r.settled, absent: r.absent, S: r.S, W: r.W });
      if (debugDate) {
        console.log(`\n${cfg.id} ${ticker} ${d.date} -> ${eCal.date} S=${r.S} W=${r.W}`);
        for (const l of r.legs)
          console.log(
            `  ${l.qty > 0 ? 'long ' : 'short'} ${l.sym} entry ${l.entry} @${new Date(l.entryMs).toISOString()} exit ${l.exit} @${new Date(l.exitMs).toISOString()} (${l.exitKind})`,
          );
        console.log('  pnl', r.pnl, 'credit', r.credit, 'maxLoss', r.maxLoss);
      }
    }
  }
}

// ---------- stats ----------
const tstat = (xs) => {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  return m / (sd / Math.sqrt(n));
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const f0 = (x) => (x >= 0 ? '+' : '') + x.toFixed(0);
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');

function daily(ts, cost) {
  const m = new Map();
  for (const t of ts) m.set(t.date, (m.get(t.date) ?? 0) + t.pnl[cost]);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
function stats(ts, cost) {
  const dl = daily(ts, cost);
  const xs = dl.map((x) => x[1]);
  let peak = 0;
  let cum = 0;
  let dd = 0;
  for (const x of xs) {
    cum += x;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  const sortedDesc = [...xs].sort((a, b) => b - a);
  const worst = dl.reduce((a, b) => (b[1] < a[1] ? b : a), dl[0] ?? ['', 0]);
  const best = dl.reduce((a, b) => (b[1] > a[1] ? b : a), dl[0] ?? ['', 0]);
  const avgCredit = ts.length ? sum(ts.map((t) => t.credit[cost])) / ts.length : NaN;
  return {
    n: ts.length,
    nights: xs.length,
    total: sum(xs),
    mean: xs.length ? sum(xs) / xs.length : NaN,
    t: tstat(xs),
    no5: sum(sortedDesc.slice(5)),
    dd,
    worst,
    best,
    avgCredit,
    perMaxLoss: ts.length ? sum(ts.map((t) => t.pnl[cost])) / sum(ts.map((t) => t.maxLoss[cost])) : NaN,
    win: ts.length ? ts.filter((t) => t.pnl[cost] > 0).length / ts.length : NaN,
    perTicker: Object.fromEntries(TICKERS.map((k) => [k, sum(ts.filter((t) => t.ticker === k).map((t) => t.pnl[cost]))])),
    perTickerT: Object.fromEntries(TICKERS.map((k) => [k, tstat(daily(ts.filter((t) => t.ticker === k), cost).map((x) => x[1]))])),
    perYear: Object.fromEntries(
      [...new Set(ts.map((t) => t.year))].sort().map((y) => [y, sum(ts.filter((t) => t.year === y).map((t) => t.pnl[cost]))]),
    ),
  };
}

const byCfg = (id) => trades.filter((t) => t.cfg === id);
const lines = [];
const out = (s = '') => lines.push(s);
out(`H2 overnight option premium — sample ${sample} ${from} -> ${to}, tickers ${TICKERS.join(',')}`);
out(`configs run: ${runConfigs.length}`);
out();
out('## All configs (daily P&L summed over tickers; $ per 1-lot structure)');
out('config | cost | structs | nights | total | mean/night | t | SPY | QQQ | IWM | no-5-best | worst night | maxDD | avg credit | pnl/maxloss (totals)');
for (const cfg of runConfigs) {
  const ts = byCfg(cfg.id);
  for (const cost of Object.keys(COSTS)) {
    const s = stats(ts, cost);
    out(
      [cfg.id, cost, s.n, s.nights, f0(s.total), f2(s.mean), f2(s.t), ...TICKERS.map((k) => f0(s.perTicker[k])), f0(s.no5), `${f0(s.worst[1])} (${s.worst[0]})`, f0(s.dd), f2(s.avgCredit), (100 * s.perMaxLoss).toFixed(2) + '%'].join(' | '),
    );
  }
}
out();
out('## Fill / skip counts per config (per ticker-night)');
for (const cfg of runConfigs) out(`${cfg.id}: ${JSON.stringify(counts[cfg.id] ?? {})}`);

// Primary detail
const primaryTs = byCfg(PRIMARY);
if (primaryTs.length) {
  out();
  out(`## Primary config detail: ${PRIMARY}`);
  for (const cost of Object.keys(COSTS)) {
    const s = stats(primaryTs, cost);
    out(`${cost}: total ${f0(s.total)}, t ${f2(s.t)}, nights ${s.nights}, structs ${s.n}, win ${(100 * s.win).toFixed(1)}%`);
    out(`  per ticker: ${TICKERS.map((k) => `${k} ${f0(s.perTicker[k])} (t ${f2(s.perTickerT[k])})`).join(', ')}`);
    out(`  per year: ${Object.entries(s.perYear).map(([y, v]) => `${y} ${f0(v)}`).join(', ')}`);
    out(`  without 5 best nights: ${f0(s.no5)}; worst night ${f0(s.worst[1])} on ${s.worst[0]}; best night ${f0(s.best[1])} on ${s.best[0]}`);
    out(`  max drawdown ${f0(s.dd)} = ${(s.dd / s.avgCredit).toFixed(1)}x avg credit (${f2(s.avgCredit)}); worst night = ${(-s.worst[1] / s.avgCredit).toFixed(1)}x avg credit`);
    out(`  P&L / max loss (ratio of totals): ${(100 * s.perMaxLoss).toFixed(2)}%`);
  }
  const noStale = primaryTs.filter((t) => t.stale === 0 && t.absent === 0);
  const s = stats(noStale, 'primary');
  out(`info only, skipping nights with any stale exit leg: ${noStale.length} structs, total ${f0(s.total)}, t ${f2(s.t)}`);
}

// Mechanism: paired overnight vs mirror
out();
out('## Mechanism: overnight(D) vs mirror(D), paired by ticker-date, summed per date');
const pairs = [
  [PRIMARY, 'MIRROR fly 09:45->15:50 w1.5%'],
  ['ON fly 15:50->09:45 w1%', 'MIRROR fly 09:45->15:50 w1%'],
  ['ON fly 15:50->09:45 w2%', 'MIRROR fly 09:45->15:50 w2%'],
  ['ON strangle 15:50->09:45 w1.5%', 'MIRROR strangle 09:45->15:50 w1.5%'],
];
for (const [a, b] of pairs) {
  const A = byCfg(a);
  const B = byCfg(b);
  if (!A.length || !B.length) continue;
  const key = (t) => `${t.ticker} ${t.date}`;
  const bMap = new Map(B.map((t) => [key(t), t]));
  for (const cost of Object.keys(COSTS)) {
    const diff = new Map();
    const on = new Map();
    const mi = new Map();
    for (const t of A) {
      const m = bMap.get(key(t));
      if (!m) continue;
      diff.set(t.date, (diff.get(t.date) ?? 0) + t.pnl[cost] - m.pnl[cost]);
      on.set(t.date, (on.get(t.date) ?? 0) + t.pnl[cost]);
      mi.set(t.date, (mi.get(t.date) ?? 0) + m.pnl[cost]);
    }
    const dx = [...diff.values()];
    const ox = [...on.values()];
    const mx = [...mi.values()];
    out(
      `${a} vs ${b} [${cost}]: paired dates ${dx.length}; overnight mean ${f2(sum(ox) / ox.length)} (t ${f2(tstat(ox))}), mirror mean ${f2(sum(mx) / mx.length)} (t ${f2(tstat(mx))}), diff mean ${f2(sum(dx) / dx.length)} (t ${f2(tstat(dx))})`,
    );
  }
}

const text = lines.join('\n');
console.log(text);
if (args.trades) writeFileSync(args.trades, trades.map((t) => JSON.stringify(t)).join('\n') + '\n');
