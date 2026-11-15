# Hypothesis round 2 — shared rules (2026-11-15)

Every agent testing a hypothesis in this folder follows these rules. Read `../LOG.md` and `../SUMMARY.md` first: they hold everything tried so far and the two simulator bugs already fixed.

## Files

- Write only: `research/hypotheses/<id>.md` (your log), `research/tools/<id>-*.mjs` (your scripts), `research/outputs/<id>-*.out` (printouts). `<id>` is e.g. `h1`.
- Do not edit `src/`, `../core/`, `LOG.md`, `SUMMARY.md`, configs, or another agent's files. Other agents are working in this tree at the same time. Do not commit.
- Use only data already in `data/`. If you need something that isn't there, say so in your report instead of downloading it.

## Pre-registration

Before running anything on prices, write in `<id>.md`: the hypothesis and who is on the other side, the exact rule, the cost model, the grid (keep it small, ≤ 30 configs; count every config you run), and the pass rule. Then run, then append results. Never edit the design after seeing results; add a dated note instead. Label anything post hoc as "information only".

## Data on disk

- `data/stocks/<T>/<DATE>.json`: 1-minute raw SIP bars 04:00–20:00 NY for SPY, QQQ, IWM, 2016-01-04 → 2026-11-13 (2024-01-02 → 01-24 missing). Alpaca bar: `{t,o,h,l,c,v}`, `t` = bar start, UTC ISO.
- `data/options/<T>/<DATE>.json`: `{ "<OCC symbol>": [bars] }`, 1-minute trade bars, 2024-02-01 → 2026-11-13, expirations 0–7 calendar days out, whole-dollar strikes from $10 below the day's low to $10 above its high. No quotes, no open interest. IWM has no daily expirations before 2024-04-22 or so.
- `data/daily/<T>.json`: adjusted daily bars 2016 → 2026-11-13 for ~7,400 tickers. WARNING: that universe is "stocks with an insider purchase in 2016–2026" plus 21 ETFs (SPY QQQ IWM EFA EEM TLT IEF GLD DBC VNQ BIL AGG, sector SPDRs). It is not a fair cross-section; don't use it for cross-sectional stock studies.
- `data/calendar.json`: trading days with open/close times (early closes included).

## Option fill model (same as the simulator; do not make it kinder)

- A trade price is treated as the midpoint. Spread = max($0.01, 1% of price). Buys pay mid + half, sells get mid − half, then round to the cent against you. Fee $0.05 per contract per side.
- An order decided at time T fills on the open of the first 1-minute bar of that contract starting at or after T, and only if one exists within 5 minutes; otherwise the order is rejected (skip the whole multi-leg trade if any leg can't fill; report how often).
- Price-triggered exits fill on the print after the trigger, never better than the trigger.
- Options held to expiry settle at intrinsic value from the underlying's official close. Use the OPEN of the 16:00 one-minute bar: its close includes after-hours prints (found by h1, 2026-11-15; the original text here said the bar's close).
- Strike look-ahead (found by h1): files hold only strikes within $10 of each day's low/high, so a strike more than $10 from spot at entry is on disk only if the day moved toward it. Restrict to legs within $10 of spot at entry, or report that restriction alongside.
- Report every result at three cost levels: primary (above), stress (2% spread), harsh ($0.04 minimum spread, i.e. two cents each way per leg).
- For short-option structures use defined risk only (every short leg covered by a long wing), and report P&L per structure in dollars and as a fraction of max loss.

## Samples

- Options: development 2024-02-01 → 2026-04-30. Holdout 2026-05-01 → 2026-11-13: run it ONCE, at the very end, on at most 2 candidates frozen in writing beforehand, and only if something passes development.
- Stock/daily studies: say in the design which years are in-sample for any choice you make and which are untouched.

## Statistics

- t-stats on daily P&L (not per trade) when trades on the same day are correlated across tickers. Report per ticker, per year, max drawdown, worst day, and the result without the 5 best days.
- With N configs tried, the best one's t is inflated; judge by the pre-registered primary config and by whether neighbours agree.

## Report back (final message)

Verdict (PASS / FAIL / INCONCLUSIVE against your own pass rule), the primary table, configs tried, the strongest reason to doubt the result, and the paths of the files you wrote. Be blunt; a clean negative is a good outcome.

---

# Round 2 (2026-11-15): h6–h10

Everything above still applies, with these additions. Also read `h1.md` from "Rerun on real quotes" to the end, and `h3.md`: both contain lessons that apply to you.

## Lessons from round 1

- **Expiring options are priced to the 17:30 exercise cutoff, not to the 16:00 close.** Settling a short option held to expiry at intrinsic from the official close credits the seller with after-hours risk they really carry (h1). Close option positions before expiry unless your design explicitly models exercise.
- **Real spreads are often much wider than the old 1% model,** especially in fast markets and on IWM. Use real quotes whenever options are involved.
- **One minute of fill timing can be worth a lot** (h3: a one-minute look-ahead turned Sharpe 0.47 into 1.40). For share strategies, report the result with fills one minute later than your primary as a robustness check.
- **Share costs:** SPY, QQQ and IWM have a one-cent spread, about 0.15–0.3 bp per side, and the opening and closing auctions have no spread to cross. Primary 1 bp per side, stress 3 bp per side, plus zero cost, unless your design argues otherwise in advance.

## New data

- `data/quotes/<T>/<DATE>.json`: real 1-minute NBBO for SPY, QQQ, IWM options, 2024-02-01 → 2026-11-13, same contracts as `data/options`. `{ "<OCC symbol>": [[epochMs, bid, ask], ...] }`, only changes stored: a contract's quote at time t is its last row at or before t. A row stamped T is the quote standing at T:00.
- `data/chains/<T>/<DATE>.json`: one NBBO snapshot per contract per day, taken 15 minutes before the close (15:45, or 12:45 on early-close days), for SPY, QQQ, IWM, 2020-01-02 → 2026-11-13. Every expiration up to 60 calendar days out and strikes from 60% of the day's low to 125% of its high. Same format, one row per contract. The 2020-01 → 2024-01 part has never been used by anyone.
- `data/bls/dates.json`: CPI and Employment Situation release dates 2016–2026 (08:30 NY, before the open). Five fall on Good Fridays, when the market is closed.
- `data/fomc/dates.json`: scheduled FOMC announcement dates (see LOG.md part 4).
- Stock 1-minute bars run 04:00–20:00, so pre-market and after-hours prices are available. The 16:00 bar's open is the closing-auction print; the 09:30 bar's open is the opening print.
- Correction (h10, 2026-11-15): that's approximate. The 16:00 bar's open differs from the official close by more than 5 bp on 3–7% of days. For auction prices prefer the official open and close in `data/daily-raw/<T>.json` (raw daily bars for the 21 ETFs, added 2026-11-15; adjusted ones are in `data/daily`). Alpaca's adjusted series misses two SPY dividends, 2016-03-18 and 2018-06-15.

## Samples

There is no untouched holdout for SPY/QQQ/IWM share data from 2016–2026: Parts 1–4 and h3/h4 have used it. So for share strategies, the protection against overfitting is the design: a single published rule with published parameters as the primary, a small grid only as a robustness check, and a pass rule set in advance. Say in your design which choices come from the literature and which are yours.
