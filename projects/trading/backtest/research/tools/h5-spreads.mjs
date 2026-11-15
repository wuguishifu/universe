// h5: weekly index credit spreads (put spreads, call mirror), held to expiry or to a 50% take-profit.
// Reads raw stock and option bars directly. Design is pre-registered in research/hypotheses/h5.md.
// usage: node h5-spreads.mjs <dev|holdout> [configIds,comma] [--trace=TICKER:YYYY-MM-DD] [--tickers=SPY,QQQ,IWM]
import {
  tradingWeeks, stockDay, spotAt, officialClose, expirations, occ, firstPrint, msAt, daysBetween,
  hhmm, MIN, DATA, nyMinute, settlement,
} from './h5-common.mjs';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const sample = args[0] ?? 'dev';
const onlyIds = args[1] && !args[1].startsWith('--') ? args[1].split(',') : null;
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const trace = opt('trace');
const tickers = (opt('tickers') ?? 'SPY,QQQ,IWM').split(',');
const dumpPath = opt('dump');
const settleMode = opt('settle') ?? 'c1559';
// Post hoc (h5.md note 2): keep only structures whose every leg is within $10 of spot at entry.
const within10 = args.includes('--within10');

const SAMPLES = {
  dev: { from: '2024-02-01', to: '2026-04-30' },
  holdout: { from: '2026-05-01', to: '2026-11-13' },
};
const { from, to } = SAMPLES[sample];

const COSTS = {
  primary: { pct: 0.01, min: 0.01 },
  stress: { pct: 0.02, min: 0.01 },
  harsh: { pct: 0.01, min: 0.04 },
};
const FEE = 0.05;

const CONFIGS = [
  { id: 'P1', type: 'P', k: 0.01, w: 0.01, entry: 'fri', exit: 'expiry' },
  { id: 'P2', type: 'P', k: 0.005, w: 0.01, entry: 'fri', exit: 'expiry' },
  { id: 'P3', type: 'P', k: 0.02, w: 0.01, entry: 'fri', exit: 'expiry' },
  { id: 'P4', type: 'P', k: 0.01, w: 0.005, entry: 'fri', exit: 'expiry' },
  { id: 'P5', type: 'P', k: 0.01, w: 0.02, entry: 'fri', exit: 'expiry' },
  { id: 'P6', type: 'P', k: 0.01, w: 0.01, entry: 'mon', exit: 'expiry' },
  { id: 'P7', type: 'P', k: 0.005, w: 0.01, entry: 'mon', exit: 'expiry' },
  { id: 'P8', type: 'P', k: 0.01, w: 0.01, entry: 'fri', exit: 'tp50' },
  { id: 'P9', type: 'P', k: 0.01, w: 0.01, entry: 'mon', exit: 'tp50' },
  // Post hoc, information only (h5.md note): P8 with no trigger in the first 5 minutes of a session.
  // Post hoc, information only (h5.md note 2): P1 with the wing chosen only among strikes within $10 of spot.
  { id: 'P1u', type: 'P', k: 0.01, w: 0.01, entry: 'fri', exit: 'expiry', cap10: true },
  { id: 'C1u', type: 'C', k: 0.01, w: 0.01, entry: 'fri', exit: 'expiry', cap10: true },
  { id: 'P8u', type: 'P', k: 0.01, w: 0.01, entry: 'fri', exit: 'tp50', cap10: true },
  { id: 'P8b', type: 'P', k: 0.01, w: 0.01, entry: 'fri', exit: 'tp50', noOpen: true },
  { id: 'C1', type: 'C', k: 0.01, w: 0.01, entry: 'fri', exit: 'expiry' },
  { id: 'C2', type: 'C', k: 0.005, w: 0.01, entry: 'fri', exit: 'expiry' },
  { id: 'C3', type: 'C', k: 0.02, w: 0.01, entry: 'fri', exit: 'expiry' },
  { id: 'C4', type: 'C', k: 0.01, w: 0.01, entry: 'mon', exit: 'expiry' },
  { id: 'C5', type: 'C', k: 0.01, w: 0.01, entry: 'fri', exit: 'tp50' },
].filter((c) => !onlyIds || onlyIds.includes(c.id) || (onlyIds.includes('IC') && ['P1', 'C1'].includes(c.id)));

// ---------- fills ----------
const roundCent = (p, side) => {
  const cents = p * 100;
  const r = side === 'buy' ? Math.ceil(cents - 1e-9) : Math.floor(cents + 1e-9);
  return Math.max(0, r) / 100;
};
const fill = (price, side, cost) => {
  const half = Math.max(cost.min, price * cost.pct) / 2;
  return roundCent(side === 'buy' ? price + half : Math.max(0, price - half), side);
};

// ---------- option chains, small LRU by date ----------
const chainCache = new Map();
const chainFor = (ticker, date) => {
  const key = `${ticker}/${date}`;
  if (chainCache.has(key)) return chainCache.get(key);
  const path = `${DATA}options/${ticker}/${date}.json`;
  let chain = null;
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    chain = new Map();
    for (const [sym, bars] of Object.entries(raw)) chain.set(sym, bars);
  }
  chainCache.set(key, chain);
  if (chainCache.size > 9) chainCache.delete(chainCache.keys().next().value);
  return chain;
};
/** Bars of one symbol with ms, sorted, from one day's file. */
const barsOf = (chain, sym) =>
  (chain?.get(sym) ?? []).map((b) => ({ ...b, ms: Date.parse(b.t) })).sort((a, b) => a.ms - b.ms);

// ---------- Black–Scholes (diagnostic only) ----------
const ncdf = (x) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
const bs = (type, S, K, T, r, v) => {
  const d1 = (Math.log(S / K) + (r + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);
  return type === 'C'
    ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2)
    : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
};
const impliedVol = (type, price, S, K, T, r = 0.045) => {
  let lo = 0.005;
  let hi = 3;
  if (bs(type, S, K, T, r, lo) > price || bs(type, S, K, T, r, hi) < price) return undefined;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bs(type, S, K, T, r, mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
};

// ---------- one trade ----------
const intrinsic = (type, K, spot) => Math.max(0, type === 'P' ? K - spot : spot - K);

function setUp(cfg, ticker, entryDay, expiryLimit) {
  const bars = stockDay(ticker, entryDay);
  const chain = chainFor(ticker, entryDay.date);
  if (!bars?.length || !chain?.size) return { skip: 'no data' };
  const m = hhmm(entryDay.close) - 30;
  const S = spotAt(bars, m);
  const t = msAt(bars, m);
  const exps = expirations(chain, ticker).filter((e) =>
    cfg.entry === 'fri' ? daysBetween(entryDay.date, e) >= 1 && daysBetween(entryDay.date, e) <= 7 : e > entryDay.date && e <= expiryLimit,
  );
  if (!exps.length) return { skip: 'no expiry' };
  const expiry = exps.at(-1);
  const sign = cfg.type === 'P' ? -1 : 1;
  const K = Math.round(S * (1 + sign * cfg.k));
  const shortSym = occ(ticker, expiry, cfg.type, K);
  const shortEntry = firstPrint(barsOf(chain, shortSym), t);
  if (!shortEntry) return { skip: 'short no print' };
  const Wt = Math.max(1, Math.round(S * cfg.w));
  const Wmin = cfg.cap10 ? 1 : Math.max(1, Math.round(S * 0.005));
  for (let W = Wt; W >= Math.min(Wmin, Wt); W--) {
    if (cfg.cap10 && Math.abs(K + sign * W - S) > 10) continue;
    const longSym = occ(ticker, expiry, cfg.type, K + sign * W);
    const longEntry = firstPrint(barsOf(chain, longSym), t);
    if (longEntry)
      return { S, t, m, expiry, K, W, Wt, sign, shortSym, longSym, shortEntry, longEntry, narrowed: W < Wt };
  }
  return { skip: 'long no print' };
}

function runTrade(cfg, ticker, entryDay, weekDays) {
  const expiryLimit = weekDays.at(-1).date;
  const s = setUp(cfg, ticker, entryDay, expiryLimit);
  if (s.skip) return s;
  const expDay = weekDays.find((d) => d.date === s.expiry);
  if (!expDay) return { skip: 'expiry not a trading day' };
  const expBars = stockDay(ticker, expDay);
  if (!expBars?.length) return { skip: 'no expiry stock data' };
  const closePx = settlement(ticker, expDay, settleMode);
  const m55 = hhmm(expDay.close) - 5;
  const t55 = msAt(expBars, m55);
  const spot55 = spotAt(expBars, m55);
  const nearShort = cfg.type === 'P' ? spot55 <= s.K * 1.005 : spot55 >= s.K * 0.995;

  // Leg bars across every day held (needed for 15:55 closes and the take-profit path).
  const heldDays = [entryDay, ...weekDays.filter((d) => d.date > entryDay.date && d.date <= s.expiry)];
  const legBars = (sym) => heldDays.flatMap((d) => barsOf(chainFor(ticker, d.date), sym));
  const shortBars = legBars(s.shortSym);
  const longBars = legBars(s.longSym);

  // Realised vol (diagnostic): S -> each daily close through expiry.
  const closes = [S0close(ticker, entryDay)];
  for (const d of heldDays.slice(1)) closes.push(settlement(ticker, d, settleMode));
  let ss = Math.log(closes[0] / s.S) ** 2;
  for (let i = 1; i < closes.length; i++) ss += Math.log(closes[i] / closes[i - 1]) ** 2;
  const rv = Math.sqrt((ss * 252) / Math.max(1, closes.length - 1));
  // Trading time: rest of the entry session plus each later session, in 252ths of a year.
  const entryLeft = (hhmm(entryDay.close) - nyMinute(s.shortEntry.ms)) / (hhmm(entryDay.close) - hhmm(entryDay.open));
  const T = (entryLeft + heldDays.length - 1) / 252;
  const iv = impliedVol(cfg.type, s.shortEntry.price, s.S, s.K, T);

  const etf = closePx / s.S - 1;
  const out = { ...s, expiryDate: s.expiry, closePx, spot55, nearShort, etf, iv, rv, byCost: {} };
  for (const [name, cost] of Object.entries(COSTS)) {
    const shortIn = fill(s.shortEntry.price, 'sell', cost);
    const longIn = fill(s.longEntry.price, 'buy', cost);
    const credit = shortIn - longIn;
    let fees = 2 * FEE;
    let exitCost;
    let how;
    // 50% take-profit scan
    if (cfg.exit === 'tp50') {
      const r = scanTakeProfit(shortBars, longBars, Math.max(s.shortEntry.ms, s.longEntry.ms), t55, credit, cost, cfg.noOpen);
      if (r) {
        exitCost = r.exitCost;
        fees += 2 * FEE;
        how = 'tp';
        var tpInfo = r;
      }
    }
    if (exitCost === undefined) {
      if (nearShort) {
        const sp = firstPrint(shortBars, t55);
        const lp = firstPrint(longBars, t55);
        const sPx = sp ? sp.price : intrinsic(cfg.type, s.K, closePx);
        const lPx = lp ? lp.price : intrinsic(cfg.type, s.K + s.sign * s.W, closePx);
        exitCost = fill(sPx, 'buy', cost) - fill(lPx, 'sell', cost);
        fees += 2 * FEE;
        how = sp && lp ? 'close1555' : 'close1555-intrinsic';
      } else {
        exitCost = intrinsic(cfg.type, s.K, closePx) - intrinsic(cfg.type, s.K + s.sign * s.W, closePx);
        how = exitCost > 0 ? 'settle-itm' : 'expire';
      }
    }
    const pnl = 100 * (credit - exitCost) - fees;
    const capital = 100 * (s.W - credit) + 2 * FEE;
    out.byCost[name] = { shortIn, longIn, credit, exitCost, fees, pnl, capital, ret: pnl / capital, how, tp: how === 'tp' ? tpInfo : undefined };
    tpInfo = undefined;
  }
  if (trace === `${ticker}:${entryDay.date}`) {
    console.log(`\nTRACE ${cfg.id} ${ticker} entry ${entryDay.date} ${JSON.stringify({ S: s.S, K: s.K, W: s.W, Wt: s.Wt, expiry: s.expiry, shortSym: s.shortSym, longSym: s.longSym, shortEntry: s.shortEntry, longEntry: s.longEntry, spot55, closePx, nearShort, iv, rv })}`);
    console.log(`  primary ${JSON.stringify(out.byCost.primary)}`);
  }
  return out;
}
function S0close(ticker, day) {
  return settlement(ticker, day, settleMode);
}

/** Minute marks once both legs printed within 5 minutes; trigger at mark <= 50% credit. */
function scanTakeProfit(shortBars, longBars, startMs, endMs, credit, cost, noOpen = false) {
  if (credit <= 0) return undefined;
  const events = [
    ...shortBars.filter((b) => b.ms > startMs && b.ms < endMs).map((b) => ({ leg: 0, b })),
    ...longBars.filter((b) => b.ms > startMs && b.ms < endMs).map((b) => ({ leg: 1, b })),
  ].sort((a, b) => a.b.ms - b.b.ms || a.leg - b.leg);
  const last = [null, null];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    last[e.leg] = e.b;
    if (events[i + 1]?.b.ms === e.b.ms) continue; // finish the minute
    if (!last[0] || !last[1]) continue;
    const now = e.b.ms;
    // Synchronous mark: both legs printed in this same minute (see h5.md note 2026-11-15).
    if (last[0].ms !== now || last[1].ms !== now) continue;
    if (noOpen && nyMinute(now) < 575) continue;
    const mark = last[0].c - last[1].c;
    if (mark > 0.5 * credit) continue;
    const after = now + MIN;
    const sp = firstPrint(shortBars, after);
    const lp = firstPrint(longBars, after);
    if (!sp || !lp || sp.ms >= endMs + 5 * MIN) continue;
    const sPx = Math.max(last[0].c, sp.price);
    const lPx = Math.min(last[1].c, lp.price);
    return { exitCost: fill(sPx, 'buy', cost) - fill(lPx, 'sell', cost), ms: Math.max(sp.ms, lp.ms), triggerMs: now, mark, sPx, lPx, shortTrig: last[0].c, longTrig: last[1].c };
  }
  return undefined;
}

// ---------- run ----------
// Weeks: the Friday-entry trade enters on the last trading day of the previous week and expires
// this week; the Monday-entry trade enters on this week's first trading day.
const weeks = tradingWeeks('2024-01-22', to);
const results = []; // {cfg, ticker, entry, expiry, ...}
const skips = {};
for (const ticker of tickers) {
  for (let wi = 1; wi < weeks.length; wi++) {
    const prev = weeks[wi - 1].days;
    const days = weeks[wi].days;
    for (const cfg of CONFIGS) {
      const entryDay = cfg.entry === 'fri' ? prev.at(-1) : days[0];
      if (cfg.entry === 'mon' && days.length < 2) continue;
      if (entryDay.date < from || entryDay.date > to) continue;
      // Friday entry: expiry may be in this week (normal) — pass this week's days plus the entry day.
      const r = runTrade(cfg, ticker, entryDay, cfg.entry === 'fri' ? [prev.at(-1), ...days] : days);
      const key = `${cfg.id} ${ticker}`;
      skips[key] ??= {};
      if (!r.skip && within10 && (Math.abs(r.K - r.S) > 10 || Math.abs(r.K + r.sign * r.W - r.S) > 10)) r.skip = 'leg > $10 from spot';
      if (r.skip) {
        skips[key][r.skip] = (skips[key][r.skip] ?? 0) + 1;
        continue;
      }
      // Sample boundary: expiry must be inside the sample too.
      if (r.expiryDate > to) {
        skips[key]['straddles split'] = (skips[key]['straddles split'] ?? 0) + 1;
        continue;
      }
      results.push({ cfg: cfg.id, ticker, entry: entryDay.date, ...r });
    }
  }
}
if (dumpPath)
  writeFileSync(
    dumpPath,
    results
      .map((r) => JSON.stringify({ cfg: r.cfg, ticker: r.ticker, entry: r.entry, expiry: r.expiryDate, S: r.S, K: r.K, W: r.W, Wt: r.Wt, close: r.closePx, etf: r.etf, iv: r.iv, rv: r.rv, ...Object.fromEntries(Object.entries(r.byCost).map(([k, v]) => [k, v])) }))
      .join('\n'),
  );

// ---------- stats ----------
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1));
};
const tstat = (a) => (a.length > 1 ? mean(a) / (sd(a) / Math.sqrt(a.length)) : NaN);
const mdd = (a) => {
  let peak = 0;
  let cum = 0;
  let dd = 0;
  for (const x of a) {
    cum += x;
    peak = Math.max(peak, cum);
    dd = Math.max(dd, peak - cum);
  }
  return dd;
};
const ols = (y, x) => {
  const n = y.length;
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - alpha - beta * x[i]) ** 2;
  const s2 = sse / (n - 2);
  const seA = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  const seB = Math.sqrt(s2 / sxx);
  return { alpha, beta, tA: alpha / seA, tB: beta / seB, r2: 1 - sse / y.reduce((s, v) => s + (v - my) ** 2, 0) };
};
const f = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const pc = (x, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : '-');

/** Weekly series: per expiry-week key, mean return over tickers. */
function weekly(rows, cost, pick = (r) => r.byCost[cost].ret) {
  const byWeek = new Map();
  for (const r of rows) {
    const k = r.entry;
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(r);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([entry, rs]) => ({ entry, ret: mean(rs.map(pick)), etf: mean(rs.map((r) => r.etf)), n: rs.length, pnl: rs.reduce((s, r) => s + r.byCost[cost].pnl, 0) }));
}

function summarize(label, rows, cost, { detail = false } = {}) {
  const w = weekly(rows, cost);
  const y = w.map((x) => x.ret);
  const x = w.map((x) => x.etf);
  const reg = ols(y, x);
  const tot = y.reduce((a, b) => a + b, 0);
  const etfTot = x.reduce((a, b) => a + b, 0);
  const scale = sd(x) / sd(y);
  const line = {
    label, cost, weeks: w.length, trades: rows.length,
    mean: mean(y), t: tstat(y), tot, mdd: mdd(y), retPerDD: tot / mdd(y),
    etfTot, etfMdd: mdd(x), etfRetPerDD: etfTot / mdd(x), vmMdd: mdd(y.map((v) => v * scale)),
    alpha: reg.alpha, tA: reg.tA, beta: reg.beta, r2: reg.r2,
    pnl: rows.reduce((s, r) => s + r.byCost[cost].pnl, 0),
    win: rows.filter((r) => r.byCost[cost].pnl > 0).length / rows.length,
    worst: Math.min(...y), best: Math.max(...y),
  };
  console.log(
    `${label.padEnd(16)} ${cost.padEnd(7)} wk ${String(line.weeks).padStart(3)} tr ${String(line.trades).padStart(3)} | mean ${pc(line.mean, 2).padStart(7)} t ${f(line.t).padStart(5)} | $${f(line.pnl, 0).padStart(6)} win ${pc(line.win, 0)} | alpha ${pc(line.alpha, 2).padStart(7)} tA ${f(line.tA).padStart(5)} beta ${f(line.beta, 1).padStart(5)} R2 ${f(line.r2)} | tot ${pc(tot, 0).padStart(6)} mdd ${pc(line.mdd, 0).padStart(5)} r/dd ${f(line.retPerDD).padStart(5)} | ETF tot ${pc(etfTot, 1)} mdd ${pc(line.etfMdd, 1)} r/dd ${f(line.etfRetPerDD)} | vol-matched mdd ${pc(line.vmMdd, 1)}`,
  );
  if (detail) {
    const years = {};
    for (const v of w) (years[v.entry.slice(0, 4)] ??= []).push(v.ret);
    console.log(`    per year: ${Object.entries(years).map(([yr, a]) => `${yr} n=${a.length} sum ${pc(a.reduce((s, b) => s + b, 0), 0)} mean ${pc(mean(a), 2)} t ${f(tstat(a))}`).join(' | ')}`);
    const sorted = [...y].sort((a, b) => b - a);
    const no5 = sorted.slice(5);
    console.log(`    worst week ${pc(line.worst)} (${w[y.indexOf(line.worst)]?.entry}), best ${pc(line.best)}; without 5 best weeks: mean ${pc(mean(no5), 2)} t ${f(tstat(no5))}; weeks < -50%: ${y.filter((v) => v < -0.5).length}`);
    const apr = w.filter((v) => ['2025-03-28', '2025-04-04', '2025-04-11', '2025-04-17'].includes(v.entry));
    console.log(`    April 2025 episode: ${apr.map((v) => `${v.entry} ret ${pc(v.ret, 0)} etf ${pc(v.etf, 1)}`).join('; ')} | sum ${pc(apr.reduce((s, v) => s + v.ret, 0), 0)}`);
    const hows = {};
    for (const r of rows) hows[r.byCost[cost].how] = (hows[r.byCost[cost].how] ?? 0) + 1;
    console.log(`    exits: ${Object.entries(hows).map(([k, v]) => `${k} ${v} (${pc(v / rows.length, 0)})`).join(', ')}; narrowed wing ${rows.filter((r) => r.narrowed).length}; mean credit $${f(mean(rows.map((r) => r.byCost[cost].credit)))} on mean width $${f(mean(rows.map((r) => r.W)))} (credit/width ${pc(mean(rows.map((r) => r.byCost[cost].credit / r.W)))})`);
    const tps = rows.filter((r) => r.byCost[cost].tp);
    if (tps.length) {
      const atOpen = tps.filter((r) => {
        const m = nyMinute(r.byCost[cost].tp.triggerMs);
        return m >= 570 && m < 575;
      });
      const sameDay = tps.filter((r) => new Date(r.byCost[cost].tp.triggerMs - 5 * 3_600_000).toISOString().slice(0, 10) === r.entry);
      const exitLoss = tps.filter((r) => r.byCost[cost].exitCost > r.byCost[cost].credit).length;
      console.log(`    take-profit exits ${tps.length}: triggered in the first 5 minutes of a session ${atOpen.length}, on the entry day ${sameDay.length}, exit cost above credit ${exitLoss}; mean ret of open-triggered ${pc(mean(atOpen.map((r) => r.byCost[cost].ret)))} vs others ${pc(mean(tps.filter((r) => !atOpen.includes(r)).map((r) => r.byCost[cost].ret)))}`);
    }
  }
  return line;
}

console.log(`h5 credit spreads — sample ${sample} (${from} → ${to}), entries in range and expiry ≤ ${to}; settlement ${settleMode}${within10 ? '; only structures with every leg within $10 of spot at entry' : ''}`);
console.log('ret = weekly return on max-loss capital; portfolio = mean over tickers traded that week; ETF = same-window underlying return; mdd on cumulative sums');
console.log('\nSkips / coverage:');
for (const [k, v] of Object.entries(skips)) {
  const n = results.filter((r) => `${r.cfg} ${r.ticker}` === k).length;
  console.log(`  ${k.padEnd(9)} traded ${n} ${JSON.stringify(v)}`);
}

const ids = CONFIGS.map((c) => c.id);
const port = tickers.filter((t) => t !== 'IWM');
const lines = [];
for (const id of ids) {
  console.log(`\n=== ${id} ${JSON.stringify(CONFIGS.find((c) => c.id === id))} ===`);
  for (const cost of Object.keys(COSTS)) {
    const rows = results.filter((r) => r.cfg === id && port.includes(r.ticker));
    if (!rows.length) continue;
    lines.push({ id, ...summarize(`${id} ${port.join('+')}`, rows, cost, { detail: cost === 'primary' && ['P1', 'C1', 'P8', 'P8b', 'P1u', 'P8u'].includes(id) }) });
  }
  for (const t of tickers) {
    const rows = results.filter((r) => r.cfg === id && r.ticker === t);
    if (rows.length) summarize(`${id} ${t}`, rows, 'primary', { detail: ['P1', 'P8', 'P8b'].includes(id) && t !== 'IWM' });
  }
}

// Iron condor = P1 + C1 the same ticker-week; capital = max of the two max losses.
if (ids.includes('P1') && ids.includes('C1')) {
  console.log('\n=== IC (P1 + C1 held together, capital = larger max loss) ===');
  const ic = [];
  for (const p of results.filter((r) => r.cfg === 'P1')) {
    const c = results.find((r) => r.cfg === 'C1' && r.ticker === p.ticker && r.entry === p.entry);
    const byCost = {};
    for (const cost of Object.keys(COSTS)) {
      const pc_ = p.byCost[cost];
      const cc = c?.byCost[cost];
      const pnl = pc_.pnl + (cc?.pnl ?? 0);
      const capital = Math.max(pc_.capital, cc?.capital ?? 0);
      byCost[cost] = { pnl, capital, ret: pnl / capital, how: cc ? 'both' : 'put only' };
    }
    ic.push({ ...p, cfg: 'IC', byCost });
  }
  for (const cost of Object.keys(COSTS)) summarize(`IC ${port.join('+')}`, ic.filter((r) => port.includes(r.ticker)), cost);
  for (const t of tickers) {
    const rows = ic.filter((r) => r.ticker === t);
    if (rows.length) summarize(`IC ${t}`, rows, 'primary');
  }
}

// Diagnostic: implied vs realised vol of the short leg.
console.log('\n=== Diagnostic: short-leg implied vol (from entry trade price) vs realised vol to expiry ===');
for (const id of ids.filter((i) => ['P1', 'P2', 'P3', 'C1', 'C2', 'C3', 'P6', 'C4'].includes(i))) {
  for (const t of tickers) {
    const rows = results.filter((r) => r.cfg === id && r.ticker === t && Number.isFinite(r.iv));
    if (!rows.length) continue;
    const diff = rows.map((r) => r.iv - r.rv);
    const vrp = rows.map((r) => r.iv ** 2 - r.rv ** 2);
    console.log(`  ${id} ${t.padEnd(4)} n ${rows.length} mean IV ${pc(mean(rows.map((r) => r.iv)))} mean RV ${pc(mean(rows.map((r) => r.rv)))} IV−RV ${pc(mean(diff))} (t ${f(tstat(diff))}) IV>RV in ${pc(diff.filter((d) => d > 0).length / rows.length, 0)}; var premium t ${f(tstat(vrp))}`);
  }
}
