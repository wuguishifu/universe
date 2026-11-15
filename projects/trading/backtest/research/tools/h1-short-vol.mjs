// H1: sell defined-risk 0DTE structures (iron butterfly / iron condor) on SPY, QQQ, IWM.
// Design and pass rule: research/hypotheses/h1.md. Reads raw JSON bars one ticker-day at a time.
//
// usage:
//   node research/tools/h1-short-vol.mjs                         development 2024-02-01 → 2026-04-30
//   node research/tools/h1-short-vol.mjs --holdout               holdout 2026-05-01 → 2026-11-13 (P only)
//   node research/tools/h1-short-vol.mjs --dump=SPY,2025-03-12   print every step of P for one ticker-day
//   node research/tools/h1-short-vol.mjs --quotes               development on real NBBO quotes (h1.md, "H1q")
//   node research/tools/h1-short-vol.mjs --quotes --holdout --candidates=ID,ID   holdout on frozen candidates
//   options: --workers=12  --from=YYYY-MM-DD --to=YYYY-MM-DD
import { readFileSync, existsSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = `${ROOT}/data`;
const TICKERS = ['SPY', 'QQQ', 'IWM'];
const FEE = 0.05;
const COSTS = {
  primary: { spreadPct: 0.01, minSpread: 0.01 },
  stress: { spreadPct: 0.02, minSpread: 0.01 },
  harsh: { spreadPct: 0.01, minSpread: 0.04 },
};
const FILL_WINDOW = 5; // minutes
// With --quotes: real bid/ask, plus this many extra cents per leg each way.
const QUOTE_COSTS = { primary: 0, stress: 0.01, harsh: 0.02 };
// Information-only switches for H1q (h1.md, dated note 2): --max-age=N and --settle=close|ah.
const ARGS = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const QUOTE_MAX_AGE = Number(ARGS['max-age'] ?? 15); // minutes since the leg's quote last changed
// close: intrinsic from the official close. ah: intrinsic from the 17:29 price, as if every holder
// made the exercise decision at the 17:30 cutoff (both ours and the other side's).
const SETTLE = ARGS.settle ?? 'close';

// ---------- configs (19, pre-registered) ----------
const hm = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const CONFIGS = [];
for (const entry of ['09:45', '10:00', '12:00', '14:00'])
  for (const structure of ['IB', 'IC'])
    for (const exit of ['expiry', 'tp50'])
      CONFIGS.push({ id: `${structure}-${entry.replace(':', '')}-${exit}`, entry, structure, exit, wingPct: 0.01, core: true });
CONFIGS.push({ id: 'IB-1000-expiry-w0.5', entry: '10:00', structure: 'IB', exit: 'expiry', wingPct: 0.005, core: false });
CONFIGS.push({ id: 'IB-1000-expiry-w2', entry: '10:00', structure: 'IB', exit: 'expiry', wingPct: 0.02, core: false });
CONFIGS.push({ id: 'IB-1000-close1550', entry: '10:00', structure: 'IB', exit: 'close', wingPct: 0.01, core: false });
const PRIMARY = 'IB-1000-expiry';

// ---------- information-only variants (added 2026-11-15 after the development run; see h1.md) ----------
// settle: 'open16' = settle on the 16:00 bar's open (the closing-auction print) instead of its close.
// worstFill: sell legs at the fill bar's low and buy legs at its high, then the modeled spread.
// maxDist: skip structures with a leg more than $10 from spot (the option files only guarantee S ± $10).
const INFO_CONFIGS = [];
const byId = (id) => CONFIGS.find((c) => c.id === id);
for (const id of ['IB-1000-expiry', 'IB-1200-expiry', 'IB-1400-expiry', 'IB-1400-tp50']) {
  INFO_CONFIGS.push({ ...byId(id), id: `${id}~open16`, settle: 'open16' });
  INFO_CONFIGS.push({ ...byId(id), id: `${id}~worstfill`, worstFill: true });
  INFO_CONFIGS.push({ ...byId(id), id: `${id}~both`, settle: 'open16', worstFill: true });
}
for (const c of CONFIGS) INFO_CONFIGS.push({ ...c, id: `${c.id}~in10`, maxDist: 10 });
for (const entry of ['12:00', '14:00']) INFO_CONFIGS.push({ ...byId(`IB-${entry.replace(':', '')}-expiry`), id: `IB-${entry.replace(':', '')}-close1550`, exit: 'close', core: false });
const ALL_CONFIGS = [...CONFIGS, ...INFO_CONFIGS];

// ---------- H1q: the same configs on real quotes (pre-registered in h1.md before the run) ----------
const AFTERNOON = ['IB-1200-expiry', 'IB-1400-expiry', 'IB-1200-close1550', 'IB-1400-close1550'];
const Q_BASE = [...CONFIGS, ...INFO_CONFIGS.filter((c) => c.id === 'IB-1200-close1550' || c.id === 'IB-1400-close1550')];
const Q_CONFIGS = [...Q_BASE, ...Q_BASE.map((c) => ({ ...c, id: `${c.id}~in10`, maxDist: 10 }))];
// Information only (h1.md, dated note 2): close all legs a few minutes before the bell instead of at 15:50.
for (const entry of ['1200', '1400'])
  for (const before of [5, 1]) Q_CONFIGS.push({ ...byId(`IB-${entry}-expiry`), id: `IB-${entry}-close${before}m`, exit: 'close', closeBefore: before, core: false });

// ---------- fill model (same as src/sim/quotes.ts) ----------
const roundToCent = (price, side) => {
  const cents = price * 100;
  const r = side === 'buy' ? Math.ceil(cents - 1e-9) : Math.floor(cents + 1e-9);
  return Math.max(0, r) / 100;
};
const fillPrice = (mid, side, cost) => {
  const half = Math.max(cost.minSpread, mid * cost.spreadPct) / 2;
  return roundToCent(side === 'buy' ? mid + half : Math.max(0, mid - half), side);
};

// ---------- time ----------
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const nyMidnightMs = (date) => {
  const noon = Date.parse(`${date}T16:00:00Z`);
  const [h] = nyFmt.format(noon).split(':').map(Number); // 11 (EDT) or 12 (EST)
  return Date.parse(`${date}T00:00:00Z`) + (16 - h) * 3600000;
};

// ---------- one ticker-day ----------
function loadDay(ticker, date) {
  const midnight = nyMidnightMs(date);
  const toMin = (t) => Math.round((Date.parse(t) - midnight) / 60000);
  const stock = JSON.parse(readFileSync(`${DATA}/stocks/${ticker}/${date}.json`, 'utf8')).map((b) => ({ m: toMin(b.t), o: b.o, c: b.c }));
  const optFile = `${DATA}/options/${ticker}/${date}.json`;
  const chain = new Map(); // "C570" -> {bars: [{m,o,c,v}] sorted, byMin: Map}
  if (existsSync(optFile)) {
    const raw = JSON.parse(readFileSync(optFile, 'utf8'));
    const tag = date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
    for (const [sym, bars] of Object.entries(raw)) {
      const rest = sym.slice(ticker.length);
      if (!sym.startsWith(ticker) || rest.slice(0, 6) !== tag) continue;
      const type = rest[6];
      const strike = Number(rest.slice(7)) / 1000;
      const list = bars.map((b) => ({ m: toMin(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })).sort((a, b) => a.m - b.m);
      chain.set(`${type}${strike}`, { bars: list, byMin: new Map(list.map((b) => [b.m, b])) });
    }
  }
  return { stock, chain, midnight };
}

/** Real NBBO changes for the day's 0DTE contracts: "C570" -> [[minute-ms offset, bid, ask], ...] sorted. */
function loadQuotes(ticker, date, midnight) {
  const file = `${DATA}/quotes/${ticker}/${date}.json`;
  const quotes = new Map();
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const tag = date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
  for (const [sym, rows] of Object.entries(raw)) {
    const rest = sym.slice(ticker.length);
    if (!sym.startsWith(ticker) || rest.slice(0, 6) !== tag) continue;
    quotes.set(`${rest[6]}${Number(rest.slice(7)) / 1000}`, rows.map(([t, b, a]) => [(t - midnight) / 60000, b, a]));
  }
  return quotes;
}

/** The NBBO standing at minute `m`: its last change at or before it. */
const quoteAtMin = (rows, m) => {
  if (!rows) return undefined;
  let lo = 0, hi = rows.length - 1, found;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] <= m) { found = rows[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found && { bid: found[1], ask: found[2], mid: (found[1] + found[2]) / 2, age: m - found[0] };
};
const usable = (q) => q && q.ask > 0 && q.bid >= 0 && q.ask >= q.bid && q.age <= QUOTE_MAX_AGE;

/** H1q: one ticker-day on real quotes (rules in h1.md, "Rerun on real quotes"). */
function runDayQuotes(ticker, day, configs, dump = false) {
  const log = dump ? console.log : () => undefined;
  const open = hm(day.open);
  const close = hm(day.close);
  const { stock, midnight } = loadDay(ticker, day.date);
  const quotes = loadQuotes(ticker, day.date, midnight);
  const out = { ticker, date: day.date, records: [], quality: null, qquality: null, bench: {} };
  const settleBar = officialClose(stock, close, open);
  // The 16:00 bar's open is the closing-auction print.
  const ScOfficial = settleBar ? (settleBar.m === close ? settleBar.o : settleBar.c) : undefined;
  const ahBar = stock.filter((b) => b.m <= 17 * 60 + 29 && b.m >= close).at(-1);
  const Sc = SETTLE === 'ah' ? (ahBar?.c ?? ScOfficial) : ScOfficial;
  const push = (base, status) => { for (const cost of Object.keys(QUOTE_COSTS)) out.records.push({ ...base, cost, status }); };
  log(`${ticker} ${day.date} session ${day.open}-${day.close}; 0DTE contracts quoted ${quotes?.size ?? 0}; official close ${Sc}`);

  for (const cfg of configs) {
    const T = hm(cfg.entry);
    const base = { cfg: cfg.id, ticker, date: day.date };
    if (!quotes || quotes.size === 0) { push(base, 'no-0dte'); continue; }
    if (T >= close - 10) { push(base, 'early-close'); continue; }
    const spotBar = stockBefore(stock, T, open);
    if (!spotBar || Sc === undefined) { push(base, 'no-stock'); continue; }
    const S = spotBar.c;
    const legs = strikesFor(cfg, S).map((l) => {
      const rows = quotes.get(`${l.type}${l.strike}`);
      return { ...l, rows, q: l.q, entry: quoteAtMin(rows, T) };
    });
    const W = legs[0].W;
    if (cfg.maxDist && legs.some((l) => Math.abs(l.strike - S) > cfg.maxDist)) { push(base, 'beyond-range'); continue; }
    if (cfg.id === PRIMARY || dump) {
      log(`\n[${cfg.id}] spot at ${cfg.entry} ${S}; K ${legs[0].K}; W ${W}`);
      for (const l of legs) log(`  ${l.q < 0 ? 'sell' : 'buy '} ${l.type}${l.strike}: ${l.entry ? `bid ${l.entry.bid} ask ${l.entry.ask} (age ${l.entry.age.toFixed(1)} min)` : 'NO QUOTE'}`);
    }
    if (cfg.id === PRIMARY) {
      out.qquality = legs.map((l) => ({ role: `${l.q < 0 ? 'short' : 'wing'}-${l.type}`, usable: usable(l.entry), spread: l.entry ? l.entry.ask - l.entry.bid : null, mid: l.entry?.mid ?? null, age: l.entry?.age ?? null }));
    }
    if (cfg.core && cfg.structure === 'IB' && cfg.exit === 'expiry' && usable(legs[0].entry) && usable(legs[1].entry)) {
      out.bench[cfg.entry] = { S, K: legs[0].strike, Sc, straddle: legs[0].entry.mid + legs[1].entry.mid, move: Math.abs(Sc - S), payoff: Math.abs(Sc - legs[0].strike) };
    }
    if (legs.some((l) => !usable(l.entry))) { push(base, 'unfilled'); continue; }
    const midCredit = legs.reduce((s, l) => s - l.q * l.entry.mid, 0);
    const inconsistent = midCredit >= W || midCredit <= 0;
    const stop = close - 10;

    for (const [costName, extra] of Object.entries(QUOTE_COSTS)) {
      // What closing leg l at quote x costs (+) or pays (−), per share.
      const closeLeg = (l, x) => (l.q < 0 ? x.ask + extra : -Math.max(0, x.bid - extra));
      const credit = legs.reduce((s, l) => s + (l.q < 0 ? Math.max(0, l.entry.bid - extra) : -(l.entry.ask + extra)), 0);
      let fees = FEE * 4;
      let exitReason = 'expiry';
      let closeDebit = 0;
      const open4 = legs.map(() => true);
      if (cfg.exit === 'tp50') {
        for (let m = T + 1; m < stop; m++) {
          const now = legs.map((l) => quoteAtMin(l.rows, m));
          if (now.some((x) => !x)) continue;
          const D = legs.reduce((s, l, i) => s - l.q * now[i].mid, 0);
          if (D > 0.5 * credit) continue;
          exitReason = 'tp50';
          const next = legs.map((l) => quoteAtMin(l.rows, m + 1));
          let atTrigger = 0;
          let atNext = 0;
          legs.forEach((l, i) => {
            const x = next[i] ?? now[i];
            if (l.q > 0 && x.bid - extra <= 0) return; // a worthless wing is left to expire
            open4[i] = false;
            fees += FEE;
            atTrigger += closeLeg(l, now[i]);
            atNext += closeLeg(l, x);
          });
          closeDebit = Math.max(atTrigger, atNext); // never better than at the trigger
          if (costName === 'primary') log(`  TP50 at ${fmtMin(m)}: mid debit ${D.toFixed(3)} <= 0.5 x credit ${credit.toFixed(2)}; close debit ${closeDebit.toFixed(2)}`);
          break;
        }
      } else if (cfg.exit === 'close') {
        exitReason = 'close';
        const at = close - (cfg.closeBefore ?? 10);
        legs.forEach((l, i) => {
          const x = quoteAtMin(l.rows, at);
          open4[i] = false;
          fees += FEE;
          closeDebit += x && x.ask > 0 ? closeLeg(l, x) : l.q < 0 ? intrinsic(l.type, l.strike, Sc) : -intrinsic(l.type, l.strike, Sc);
        });
      }
      const settle = legs.reduce((s, l, i) => s + (open4[i] ? -l.q * intrinsic(l.type, l.strike, Sc) : 0), 0);
      const pnl = 100 * (credit - closeDebit - settle) - fees;
      const maxLoss = 100 * (W - credit) + FEE * 4;
      out.records.push({ ...base, cost: costName, status: 'ok', pnl, credit: 100 * credit, maxLoss, exitReason, inconsistent, midCredit: 100 * midCredit });
      if (costName === 'primary' && (cfg.id === PRIMARY || dump))
        log(`  ${costName}: credit/share ${credit.toFixed(2)} (mid ${midCredit.toFixed(3)}); expiry value ${settle.toFixed(2)}; fees ${fees.toFixed(2)}; P&L $${pnl.toFixed(2)}; exit ${exitReason}`);
    }
  }
  return out;
}

/** Last stock close of a bar starting before minute `m` (and at or after `from`). */
const stockBefore = (stock, m, from) => {
  let best;
  for (const b of stock) if (b.m < m && b.m >= from && (!best || b.m > best.m)) best = b;
  return best;
};
const officialClose = (stock, close, open) => stock.find((b) => b.m === close) ?? stockBefore(stock, close, open);

const firstBarIn = (leg, from, to) => {
  if (!leg) return undefined;
  for (let m = from; m <= to; m++) {
    const b = leg.byMin.get(m);
    if (b) return b;
  }
  return undefined;
};

const intrinsic = (type, strike, spot) => Math.max(0, type === 'C' ? spot - strike : strike - spot);

function strikesFor(cfg, S) {
  const K = Math.floor(S + 0.5);
  const W = Math.max(1, Math.round(cfg.wingPct * S));
  if (cfg.structure === 'IB')
    return [
      { type: 'C', strike: K, q: -1 },
      { type: 'P', strike: K, q: -1 },
      { type: 'C', strike: K + W, q: 1 },
      { type: 'P', strike: K - W, q: 1 },
    ].map((l) => ({ ...l, W, K }));
  let kc = Math.round(1.005 * S);
  let kp = Math.round(0.995 * S);
  while (kc <= S || kc === K) kc++;
  while (kp >= S || kp === K) kp--;
  return [
    { type: 'C', strike: kc, q: -1 },
    { type: 'P', strike: kp, q: -1 },
    { type: 'C', strike: kc + W, q: 1 },
    { type: 'P', strike: kp - W, q: 1 },
  ].map((l) => ({ ...l, W, K }));
}

function runDay(ticker, day, configs, dump = false) {
  const log = dump ? console.log : () => undefined;
  const open = hm(day.open);
  const close = hm(day.close);
  const { stock, chain } = loadDay(ticker, day.date);
  const out = { ticker, date: day.date, records: [], quality: null, bench: {} };
  const has0dte = chain.size > 0;
  const settleBar = officialClose(stock, close, open);
  const ScClose = settleBar?.c;
  const ScOpen = settleBar ? (settleBar.m === close ? settleBar.o : settleBar.c) : undefined;
  let Sc = ScClose;
  log(`${ticker} ${day.date} session ${day.open}-${day.close}; 0DTE contracts ${chain.size}; official close (bar ${settleBar && fmtMin(settleBar.m)}) ${Sc}`);

  for (const cfg of configs) {
    const T = hm(cfg.entry);
    const base = { cfg: cfg.id, ticker, date: day.date };
    Sc = cfg.settle === 'open16' ? ScOpen : ScClose;
    if (!has0dte) {
      for (const cost of Object.keys(COSTS)) out.records.push({ ...base, cost, status: 'no-0dte' });
      continue;
    }
    if (T >= close - 10) {
      for (const cost of Object.keys(COSTS)) out.records.push({ ...base, cost, status: 'early-close' });
      continue;
    }
    const spotBar = stockBefore(stock, T, open);
    if (!spotBar || Sc === undefined) {
      for (const cost of Object.keys(COSTS)) out.records.push({ ...base, cost, status: 'no-stock' });
      continue;
    }
    const S = spotBar.c;
    const legs = strikesFor(cfg, S).map((l) => {
      const data = chain.get(`${l.type}${l.strike}`);
      return { ...l, data, fill: firstBarIn(data, T, T + FILL_WINDOW) };
    });
    const W = legs[0].W;
    if (cfg.maxDist && legs.some((l) => Math.abs(l.strike - S) > cfg.maxDist)) {
      for (const cost of Object.keys(COSTS)) out.records.push({ ...base, cost, status: 'beyond-range' });
      continue;
    }
    if (cfg.id === PRIMARY || dump) {
      log(`\n[${cfg.id}] spot at ${cfg.entry} (bar ${fmtMin(spotBar.m)} close) ${S}; K ${legs[0].K}; W ${W}`);
      for (const l of legs)
        log(`  ${l.q < 0 ? 'sell' : 'buy '} ${l.type}${l.strike}: ${l.data ? l.data.bars.length + ' bars' : 'no contract'}; fill bar ${l.fill ? `${fmtMin(l.fill.m)} o ${l.fill.o} v ${l.fill.v}` : 'NONE'}`);
    }
    if (cfg.id === PRIMARY) {
      out.quality = legs.map((l) => ({ role: `${l.q < 0 ? 'short' : 'wing'}-${l.type}`, exists: !!l.data, filled: !!l.fill, delay: l.fill ? l.fill.m - T : null, vol: l.fill?.v ?? null }));
    }
    if (cfg.core && cfg.structure === 'IB' && cfg.exit === 'expiry') {
      const [sc, sp] = legs;
      if (sc.fill && sp.fill) out.bench[cfg.entry] = { S, K: sc.strike, Sc, straddle: sc.fill.o + sp.fill.o, move: Math.abs(Sc - S), payoff: Math.abs(Sc - sc.strike) };
    }
    if (legs.some((l) => !l.fill)) {
      for (const cost of Object.keys(COSTS)) out.records.push({ ...base, cost, status: 'unfilled' });
      continue;
    }
    const midCredit = legs.reduce((s, l) => s - l.q * l.fill.o, 0);
    const [sC, sP, wC, wP] = legs;
    const inconsistent = wC.fill.o > sC.fill.o || wP.fill.o > sP.fill.o || midCredit >= W || midCredit <= 0;
    const maxFill = Math.max(...legs.map((l) => l.fill.m));

    for (const [costName, cost] of Object.entries(COSTS)) {
      const entryMid = (l) => (cfg.worstFill ? (l.q < 0 ? l.fill.l : l.fill.h) : l.fill.o);
      const credit = legs.reduce((s, l) => s + (l.q < 0 ? fillPrice(entryMid(l), 'sell', cost) : -fillPrice(entryMid(l), 'buy', cost)), 0);
      let fees = FEE * 4;
      let exitReason = 'expiry';
      // value owed to close each leg (per share, positive = we pay), and which legs settle at expiry
      let closeDebit = 0;
      const open4 = legs.map(() => true);
      const stop = close - 10;
      if (cfg.exit === 'tp50') {
        const marks = legs.map((l) => l.fill.o);
        for (let m = maxFill; m < stop; m++) {
          legs.forEach((l, i) => {
            const b = l.data.byMin.get(m);
            if (b) marks[i] = b.c;
          });
          const D = legs.reduce((s, l, i) => s - l.q * marks[i], 0);
          if (D <= 0.5 * credit) {
            exitReason = 'tp50';
            let actualMid = 0;
            let markMid = 0;
            legs.forEach((l, i) => {
              const b = firstBarIn(l.data, m + 1, m + 1 + FILL_WINDOW);
              if (!b) return; // stays open, settles at expiry
              open4[i] = false;
              actualMid += -l.q * b.o;
              markMid += -l.q * marks[i];
              closeDebit += l.q < 0 ? fillPrice(b.o, 'buy', cost) : -fillPrice(b.o, 'sell', cost);
              fees += FEE;
            });
            closeDebit += Math.max(0, markMid - actualMid); // never better than the trigger
            if (costName === 'primary') log(`  TP50 (${costName}) triggered at bar ${fmtMin(m)}: mark debit ${D.toFixed(3)} <= 0.5 x credit ${credit.toFixed(2)}; close debit ${closeDebit.toFixed(2)}; open legs ${open4.filter(Boolean).length}`);
            break;
          }
        }
      } else if (cfg.exit === 'close') {
        exitReason = 'close';
        legs.forEach((l, i) => {
          const b = firstBarIn(l.data, stop, stop + FILL_WINDOW);
          open4[i] = false;
          fees += FEE;
          const mid = b ? b.o : intrinsic(l.type, l.strike, Sc);
          closeDebit += l.q < 0 ? fillPrice(mid, 'buy', cost) : -fillPrice(mid, 'sell', cost);
        });
      }
      const settle = legs.reduce((s, l, i) => s + (open4[i] ? -l.q * intrinsic(l.type, l.strike, Sc) : 0), 0);
      const pnl = 100 * (credit - closeDebit - settle) - fees;
      const maxLoss = 100 * (W - credit) + FEE * 4;
      out.records.push({ ...base, cost: costName, status: 'ok', pnl, credit: 100 * credit, maxLoss, exitReason, inconsistent, midCredit: 100 * midCredit });
      if (costName === 'primary' && (cfg.id === PRIMARY || dump))
        log(`  ${costName}: credit/share ${credit.toFixed(2)} (mid ${midCredit.toFixed(3)}); expiry value ${settle.toFixed(2)}; fees ${fees.toFixed(2)}; P&L $${pnl.toFixed(2)}; max loss $${maxLoss.toFixed(2)}; exit ${exitReason}`);
    }
  }
  return out;
}
const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------- worker ----------
if (!isMainThread) {
  const configs = (workerData.quotes ? Q_CONFIGS : ALL_CONFIGS).filter((c) => workerData.configIds.includes(c.id));
  parentPort.on('message', (task) => {
    if (task === null) return process.exit(0);
    parentPort.postMessage((workerData.quotes ? runDayQuotes : runDay)(task.ticker, task.day, configs));
  });
} else {
  main();
}

// ---------- main ----------
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const holdout = 'holdout' in args;
  const useQuotes = 'quotes' in args;
  const candidates = args.candidates ? args.candidates.split(',') : null;
  if (holdout && useQuotes && !candidates) throw new Error('a quotes holdout needs --candidates (frozen in h1.md first)');
  const from = args.from ?? (holdout ? '2026-05-01' : '2024-02-01');
  const to = args.to ?? (holdout ? '2026-11-13' : '2026-04-30');
  if (!holdout && to > '2026-04-30') throw new Error('development ends 2026-04-30; use --holdout');
  const calendar = JSON.parse(readFileSync(`${DATA}/calendar.json`, 'utf8')).filter((d) => d.date >= from && d.date <= to && existsSync(`${DATA}/stocks/SPY/${d.date}.json`));

  if (args.dump) {
    const [ticker, date] = args.dump.split(',');
    const day = calendar.find((d) => d.date === date) ?? JSON.parse(readFileSync(`${DATA}/calendar.json`, 'utf8')).find((d) => d.date === date);
    const pool = useQuotes ? Q_CONFIGS : ALL_CONFIGS;
    const cfgs = pool.filter((c) => c.id === (args.cfg ?? PRIMARY));
    const r = (useQuotes ? runDayQuotes : runDay)(ticker, day, cfgs, true);
    console.log('\nbenchmark', r.bench);
    return;
  }

  const info = 'info' in args;
  const configIds = useQuotes
    ? holdout
      ? candidates
      : Q_CONFIGS.map((c) => c.id)
    : holdout
      ? [PRIMARY]
      : (info ? ALL_CONFIGS : CONFIGS).map((c) => c.id);
  const tasks = [];
  for (const day of calendar) for (const ticker of TICKERS) tasks.push({ ticker, day });
  const nWorkers = Number(args.workers ?? Math.min(12, cpus().length));
  const results = [];
  await new Promise((resolve, reject) => {
    let next = 0;
    let done = 0;
    for (let i = 0; i < nWorkers; i++) {
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: { configIds, quotes: useQuotes }, argv: process.argv.slice(2) });
      const feed = () => w.postMessage(next < tasks.length ? tasks[next++] : null);
      w.on('message', (r) => {
        results.push(r);
        if (++done === tasks.length) resolve();
        feed();
      });
      w.on('error', reject);
      feed();
    }
  });
  report(results, configIds, { from, to, holdout, info, quotes: useQuotes });
}

// ---------- stats ----------
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const tstat = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  const sd = Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(a.length) : NaN;
};
const maxDD = (series) => {
  let peak = 0, eq = 0, dd = 0;
  for (const x of series) {
    eq += x;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  return dd;
};
const $ = (x) => (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
const pct = (x) => (100 * x).toFixed(1) + '%';
const yearOf = (d) => d.slice(0, 4);

function summarize(recs) {
  const ok = recs.filter((r) => r.status === 'ok');
  const byDay = new Map();
  const creditByDay = new Map();
  for (const r of ok) {
    byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.pnl);
    creditByDay.set(r.date, (creditByDay.get(r.date) ?? 0) + r.credit);
  }
  const dates = [...byDay.keys()].sort();
  const daily = dates.map((d) => byDay.get(d));
  const sorted = [...daily].sort((a, b) => b - a);
  const avgCredit = mean([...creditByDay.values()]);
  const perTicker = Object.fromEntries(
    TICKERS.map((t) => {
      const tr = ok.filter((r) => r.ticker === t);
      return [t, { n: tr.length, net: sum(tr.map((r) => r.pnl)), t: tstat(tr.map((r) => r.pnl)) }];
    }),
  );
  const years = {};
  for (const d of dates) years[yearOf(d)] = (years[yearOf(d)] ?? 0) + byDay.get(d);
  const worstIdx = daily.indexOf(Math.min(...daily));
  return {
    n: ok.length,
    days: dates.length,
    net: sum(daily),
    perDay: mean(daily),
    t: tstat(daily),
    win: ok.filter((r) => r.pnl > 0).length / ok.length,
    worst: daily[worstIdx],
    worstDate: dates[worstIdx],
    dd: maxDD(daily),
    avgCredit,
    no5: sum(sorted.slice(5)),
    rom: mean(ok.map((r) => r.pnl / r.maxLoss)),
    romAgg: sum(ok.map((r) => r.pnl)) / sum(ok.map((r) => r.maxLoss)),
    romMed: ok.map((r) => r.pnl / r.maxLoss).sort((a, b) => a - b)[Math.floor(ok.length / 2)],
    perTicker,
    years,
    tp: ok.filter((r) => r.exitReason === 'tp50').length,
    avgMaxLoss: mean(ok.map((r) => r.maxLoss)),
    avgTradeCredit: mean(ok.map((r) => r.credit)),
  };
}

function report(results, configIds, { from, to, holdout, info, quotes }) {
  const all = results.flatMap((r) => r.records);
  const p = (...a) => console.log(...a);
  p(`H1${quotes ? `q (real NBBO quotes; settled ${SETTLE === 'ah' ? 'at the 17:29 price' : 'on the 16:00 bar open'}; quote max age ${QUOTE_MAX_AGE} min)` : ''} short 0DTE structures — ${holdout ? 'HOLDOUT' : 'development'} ${from} → ${to}`);
  if (quotes) p('cost levels: primary = real bid/ask; stress = +1¢ per leg each way; harsh = +2¢');
  p(`ticker-days processed: ${results.length}; configs: ${configIds.length}\n`);

  // Skip accounting for each config (primary costs).
  p('## Structures taken and skipped (per config, primary costs)');
  p('config                   ok    no-0dte  early-close  unfilled  no-stock  beyond-$10');
  for (const id of configIds) {
    const r = all.filter((x) => x.cfg === id && x.cost === 'primary');
    const c = (s) => r.filter((x) => x.status === s).length;
    p(`${id.padEnd(24)} ${String(c('ok')).padStart(4)}  ${String(c('no-0dte')).padStart(7)}  ${String(c('early-close')).padStart(11)}  ${String(c('unfilled')).padStart(8)}  ${String(c('no-stock')).padStart(8)}  ${String(c('beyond-range')).padStart(10)}`);
  }

  // Grid table.
  p('\n## All configs: net $, daily t, per ticker net, worst day, max DD (÷ avg daily credit), w/o 5 best');
  p('config                   cost     n     net        t      SPY        QQQ        IWM        worst(÷cr)       maxDD(÷cr)       no5best   ΣP&L/Σmaxloss  avg daily credit   by year');
  const summ = {};
  for (const id of configIds)
    for (const cost of Object.keys(COSTS)) {
      const s = summarize(all.filter((x) => x.cfg === id && x.cost === cost));
      summ[`${id}|${cost}`] = s;
      p(
        `${id.padEnd(24)} ${cost.padEnd(8)} ${String(s.n).padStart(4)}  ${$(s.net).padStart(9)}  ${f2(s.t).padStart(6)}  ${TICKERS.map((t) => $(s.perTicker[t].net).padStart(9)).join('  ')}  ${($(s.worst) + ' (' + f2(s.worst / s.avgCredit) + ')').padStart(15)}  ${($(s.dd) + ' (' + f2(s.dd / s.avgCredit) + ')').padStart(15)}  ${$(s.no5).padStart(9)}  ${pct(s.romAgg).padStart(10)}  ${$(s.avgCredit).padStart(9)}        ${Object.entries(s.years).map(([y, v]) => `${y} ${$(v)}`).join(' ')}`,
      );
    }

  // Primary detail (plus information-only detail for afternoon entries when --info).
  const details = quotes ? (holdout ? configIds : [PRIMARY, ...AFTERNOON]) : info ? [PRIMARY, 'IB-1200-expiry', 'IB-1400-expiry'] : [PRIMARY];
  for (const D of details) {
  p(`\n## ${D === PRIMARY ? 'Primary config' : 'Information only:'} ${D} detail`);
  for (const cost of Object.keys(COSTS)) {
    const s = summ[`${D}|${cost}`];
    if (!s) continue;
    p(`\n### ${cost}`);
    p(`structures ${s.n} over ${s.days} days; net ${$(s.net)}; per day ${$(s.perDay)}; daily t ${f2(s.t)}; win rate ${pct(s.win)}`);
    p(`avg credit per structure $${s.avgTradeCredit.toFixed(2)}, avg max loss $${s.avgMaxLoss.toFixed(2)}; avg daily credit (all tickers) $${s.avgCredit.toFixed(2)}`);
    p(`total P&L / total max loss ${pct(s.romAgg)}; median of per-structure P&L / max loss ${pct(s.romMed)} (the per-structure mean, ${pct(s.rom)}, is distorted by a few structures whose prints make max loss ≈ $0)`);
    p(`worst day ${$(s.worst)} on ${s.worstDate} (${f2(s.worst / s.avgCredit)} × avg daily credit); max drawdown ${$(s.dd)} (${f2(s.dd / s.avgCredit)} × avg daily credit)`);
    p(`without 5 best days ${$(s.no5)}`);
    p(`per ticker: ${TICKERS.map((t) => `${t} ${$(s.perTicker[t].net)} (n ${s.perTicker[t].n}, t ${f2(s.perTicker[t].t)})`).join('; ')}`);
    p(`per year: ${Object.entries(s.years).map(([y, v]) => `${y} ${$(v)}`).join('; ')}`);
    // per ticker per year
    const ok = all.filter((x) => x.cfg === D && x.cost === cost && x.status === 'ok');
    for (const t of TICKERS) {
      const yy = {};
      for (const r of ok.filter((r) => r.ticker === t)) yy[yearOf(r.date)] = (yy[yearOf(r.date)] ?? 0) + r.pnl;
      p(`  ${t} by year: ${Object.entries(yy).map(([y, v]) => `${y} ${$(v)}`).join('; ')}`);
    }
    // 10 worst structures
    if (cost === 'primary') {
      const worst = [...ok].sort((a, b) => a.pnl - b.pnl).slice(0, 8);
      p(`  worst structures: ${worst.map((r) => `${r.ticker} ${r.date} ${$(r.pnl)} (credit $${r.credit.toFixed(0)}, maxloss $${r.maxLoss.toFixed(0)})`).join('; ')}`);
      const cons = ok.filter((r) => !r.inconsistent);
      const sc = summarize(cons.map((r) => r));
      p(`  information only, excluding ${ok.length - cons.length} structures with inconsistent prints: n ${sc.n}, net ${$(sc.net)}, t ${f2(sc.t)}`);
    }
  }
  }

  // Leg quality on real quotes.
  const qq = results.filter((r) => r.qquality);
  if (qq.length) {
    p(`\n## Leg quotes at entry, ${PRIMARY} (${qq.length} ticker-days with a quoted 0DTE chain)`);
    p('ticker role       usable   median spread   mean spread/mid   median age (min)');
    const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    for (const t of TICKERS)
      for (const role of ['short-C', 'short-P', 'wing-C', 'wing-P']) {
        const legs = qq.filter((r) => r.ticker === t).map((r) => r.qquality.find((x) => x.role === role));
        const u = legs.filter((l) => l.usable);
        p(`${t}    ${role.padEnd(9)}  ${pct(u.length / legs.length).padStart(6)}   $${median(u.map((l) => l.spread)).toFixed(3).padStart(6)}        ${pct(mean(u.filter((l) => l.mid > 0).map((l) => l.spread / l.mid))).padStart(7)}        ${median(u.map((l) => l.age)).toFixed(2)}`);
      }
  }

  // Leg quality.
  const q = results.filter((r) => r.quality);
  if (q.length) {
    p(`\n## Leg data quality, ${PRIMARY} (${q.length} ticker-days with a 0DTE chain)`);
    p('ticker role       contract exists  filled ≤5m   delay 0 / 1-2 / 3-5 min (of filled)   fill-bar volume ≤2 contracts');
    for (const t of TICKERS)
      for (const role of ['short-C', 'short-P', 'wing-C', 'wing-P']) {
        const legs = q.filter((r) => r.ticker === t).map((r) => r.quality.find((x) => x.role === role));
        const filled = legs.filter((l) => l.filled);
        const d0 = filled.filter((l) => l.delay === 0).length;
        const d12 = filled.filter((l) => l.delay >= 1 && l.delay <= 2).length;
        const d35 = filled.filter((l) => l.delay >= 3).length;
        const lowVol = filled.filter((l) => l.vol <= 2).length;
        p(`${t}    ${role.padEnd(9)}  ${pct(legs.filter((l) => l.exists).length / legs.length).padStart(14)}  ${pct(filled.length / legs.length).padStart(10)}   ${[d0, d12, d35].map((x) => pct(x / filled.length)).join(' / ').padStart(28)}   ${pct(lowVol / filled.length).padStart(10)}`);
      }
    const okP = all.filter((x) => x.cfg === PRIMARY && x.cost === 'primary' && x.status === 'ok');
    p(`structures with inconsistent prints (wing above its short leg, or mid credit ≥ W or ≤ 0): ${okP.filter((r) => r.inconsistent).length} of ${okP.length}`);
  }

  // Benchmark.
  for (const entry of ['09:45', '10:00', '12:00', '14:00']) {
    const b = results.filter((r) => r.bench[entry]);
    if (!b.length) continue;
    p(`\n## Unhedged benchmark at ${entry} (information only): ATM straddle print (no costs) vs realised move to the official close`);
    p('ticker   n     straddle   |close−S|   |close−K| (payoff)   payoff/straddle   straddle − payoff (per share)   share of days payoff > straddle');
    for (const t of TICKERS) {
      const x = b.filter((r) => r.ticker === t).map((r) => r.bench[entry]);
      const st = mean(x.map((y) => y.straddle));
      const mv = mean(x.map((y) => y.move));
      const po = mean(x.map((y) => y.payoff));
      const diff = x.map((y) => y.straddle - y.payoff);
      p(`${t}    ${String(x.length).padStart(4)}   ${st.toFixed(3).padStart(8)}   ${mv.toFixed(3).padStart(9)}   ${po.toFixed(3).padStart(18)}   ${(po / st).toFixed(3).padStart(15)}   ${mean(diff).toFixed(3).padStart(10)} (t ${f2(tstat(diff))})   ${pct(x.filter((y) => y.payoff > y.straddle).length / x.length).padStart(10)}`);
    }
  }

  // Pass rule.
  if (quotes) return quotePassRules(summ, configIds, holdout, p);
  if (!holdout) {
    const P = (c) => summ[`${PRIMARY}|${c}`];
    const yearsOk = Object.values(P('primary').years).every((v) => v > 0);
    const tick = TICKERS.filter((t) => P('primary').perTicker[t].net > 0).length;
    const corePos = CONFIGS.filter((c) => c.core).filter((c) => summ[`${c.id}|primary`].net > 0).length;
    const rules = [
      ['1 net > 0 at primary and stress', P('primary').net > 0 && P('stress').net > 0],
      [`2 daily t ≥ 2.5 (${f2(P('primary').t)})`, P('primary').t >= 2.5],
      [`3 every dev year > 0 (${Object.entries(P('primary').years).map(([y, v]) => `${y} ${$(v)}`).join(', ')})`, yearsOk],
      [`4 ≥ 2 of 3 tickers > 0 (${tick})`, tick >= 2],
      [`5 > 0 without 5 best days (${$(P('primary').no5)})`, P('primary').no5 > 0],
      [`6 harsh ≥ 0 (${$(P('harsh').net)})`, P('harsh').net >= 0],
      [`7 ≥ 8 of 16 core configs > 0 (${corePos})`, corePos >= 8],
    ];
    p('\n## Pass rule (primary config)');
    for (const [name, okk] of rules) p(`${okk ? 'PASS' : 'FAIL'}  ${name}`);
    p(`VERDICT: ${rules.every((r) => r[1]) ? 'PASS' : 'FAIL'}`);
  } else {
    const P = summ[`${PRIMARY}|primary`];
    const tick = TICKERS.filter((t) => P.perTicker[t].net > 0).length;
    p('\n## Holdout pass rule');
    p(`${tick >= 2 ? 'PASS' : 'FAIL'}  ≥ 2 of 3 tickers > 0 (${tick})`);
    p(`${P.t >= 2 ? 'PASS' : 'FAIL'}  daily t ≥ 2 (${f2(P.t)})`);
    p(`${summ[`${PRIMARY}|stress`].net >= 0 ? 'PASS' : 'FAIL'}  stress ≥ 0 (${$(summ[`${PRIMARY}|stress`].net)})`);
  }
}

function quotePassRules(summ, configIds, holdout, p) {
  const devRules = (id) => {
    const P = (c) => summ[`${id}|${c}`];
    const tick = TICKERS.filter((t) => P('primary').perTicker[t].net > 0).length;
    return [
      ['1 net > 0 at primary and stress', P('primary').net > 0 && P('stress').net > 0],
      [`2 daily t ≥ 2.5 (${f2(P('primary').t)})`, P('primary').t >= 2.5],
      [`3 every dev year > 0 (${Object.entries(P('primary').years).map(([y, v]) => `${y} ${$(v)}`).join(', ')})`, Object.values(P('primary').years).every((v) => v > 0)],
      [`4 ≥ 2 of 3 tickers > 0 (${tick})`, tick >= 2],
      [`5 > 0 without 5 best days (${$(P('primary').no5)})`, P('primary').no5 > 0],
      [`6 harsh ≥ 0 (${$(P('harsh').net)})`, P('harsh').net >= 0],
    ];
  };
  if (holdout) {
    for (const id of configIds) {
      const P = summ[`${id}|primary`];
      const tick = TICKERS.filter((t) => P.perTicker[t].net > 0).length;
      const rules = [
        [`≥ 2 of 3 tickers > 0 (${tick})`, tick >= 2],
        [`daily t ≥ 2 (${f2(P.t)})`, P.t >= 2],
        [`stress ≥ 0 (${$(summ[`${id}|stress`].net)})`, summ[`${id}|stress`].net >= 0],
      ];
      p(`\n## Holdout pass rule: ${id}`);
      for (const [name, ok] of rules) p(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
      p(`VERDICT ${id}: ${rules.every((r) => r[1]) ? 'PASS' : 'FAIL'}`);
    }
    return;
  }
  p('\n## Pass rule 1: the primary config, development rule (items 1–6; item 7 below)');
  const r1 = devRules(PRIMARY);
  const corePos = CONFIGS.filter((c) => c.core).filter((c) => summ[`${c.id}|primary`].net > 0).length;
  r1.push([`7 ≥ 8 of 16 core configs > 0 (${corePos})`, corePos >= 8]);
  for (const [name, ok] of r1) p(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  p(`VERDICT P: ${r1.every((r) => r[1]) ? 'PASS' : 'FAIL'}`);
  p('\n## Pass rule 2: does the afternoon effect survive? (items 1–6, and ~in10 positive with t ≥ 2)');
  for (const id of AFTERNOON) {
    const rules = devRules(id);
    const in10 = summ[`${id}~in10|primary`];
    rules.push([`in10 net > 0 and t ≥ 2 (${$(in10.net)}, t ${f2(in10.t)})`, in10.net > 0 && in10.t >= 2]);
    p(`\n${id}`);
    for (const [name, ok] of rules) p(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    p(`  ${id}: ${rules.every((r) => r[1]) ? 'SURVIVES' : 'DOES NOT SURVIVE'}`);
  }
}
