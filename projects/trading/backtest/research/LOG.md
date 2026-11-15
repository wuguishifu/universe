# Research log

Goal: find an options strategy that survives a held-out test, or show that none does.

## Protocol (fixed before any run)

- **Tickers:** SPY, QQQ, IWM, run together as one portfolio (one engine, 1 contract per entry, at most one position per ticker). Per-ticker results come from the same run.
- **Development range:** 2024-02-01 → 2026-04-30. All research happens here.
- **Holdout:** 2026-05-01 → 2026-11-13. Not run until the end, once, on at most 3 frozen candidates.
- **Primary costs:** `fillAt: nextTrade`, `spreadPct: 0.01`, `minSpread: 0.01`, `feePerContract: 0.05`.
- **Stress costs:** `spreadPct: 0.02`, everything else the same.
- **Development pass:** positive on all 3 tickers at primary costs, combined t ≥ 2.5, ≥ 300 trades, and no development year with a loss (2024, 2025, 2026 Jan–Apr).
- **Holdout pass:** positive on ≥ 2 of 3 tickers, combined t ≥ 2, and not negative at stress costs.
- **Ranking:** by consistency (median across tickers, worst year, neighbors also positive), not by the best row.
- **Budget:** at most about 10 strategy ideas, small grids.

Data check (2026-11-14): SPY, QQQ and IWM each have 705 stock days (2024-01-25 → 2026-11-13) and 700 option days (Alpaca's option history starts 2024-02-01). IWM's option files are about a third the size of SPY's, as expected for a thinner chain.

## Configs tried

A running total, so the final t-stats can be read with the number of tries in mind.

| #   | Idea                                                    | Configs | Running total |
| --- | ------------------------------------------------------- | ------- | ------------- |
| 1   | EMA9/VWAP crossover baseline                            | 288     | 288           |
| 2   | Noise-area breakout                                     | 144     | 432           |
| 3   | Last-half-hour intraday momentum                        | 192     | 624           |
| —   | Reruns of 1–3 with the fill fix (same configs)          | 0       | 624           |
| 4   | Opening-range breakout                                  | 216     | 840           |
| 3b  | Late-momentum surface                                   | 200     | 1,040         |
| 5   | Late entry outside the noise band                       | 48      | 1,088         |
| 3c  | Late momentum, with vs against                          | 12      | 1,100         |
| —   | Reruns of everything with the expiry fix (same configs) | 0       | 1,100         |

## Ideas

Each entry is written before its run, then the result is added below it.

### 1. EMA9/VWAP crossover baseline on three tickers

**Why:** The SPY grid showed no edge after a 2% spread, but most configs were positive at zero cost. QQQ moves about 1.3× as much as SPY for similar spreads, so the same signal may clear costs there. This is the baseline every later idea has to beat.

**Grid (288):** timeframe 3/5/10m × EMA close-break on/off × stop30 on/off × target tp50/tp100/none × 0DTE/1DTE × ATM/OTM1 × exit-on-cross/hold, with a 15-minute start delay, a cooldown, and flat 10 minutes before the close.

**Expectation:** Mostly negative at primary costs. QQQ better than SPY, IWM worst.

**Result** (`runs/2026-11-15T07-49-31-sweep-01-ema-vwap-baseline`): no edge. 33 of 288 configs profitable; median t −1.64, best t 1.5; 0 pass. Only 6 configs were positive on all three tickers, and none had t above 1 on any single ticker. QQQ wasn't better than SPY (median −$2,666 vs −$1,662). The settings that lost least were the same as on SPY alone: 10-minute bars, no premium stop, a +50% target, 0DTE. The best row (10m · no-ema · no-stop · tp50 · 0dte · atm · exit-on-cross, t 1.5) is what you'd expect from the best of 288 by luck.

### 2. Noise-area breakout (Zarattini, Aziz and Barbon, 2024)

**Why:** "Beat the Market: An Effective Intraday Momentum Strategy for S&P500 ETF (SPY)" reports a Sharpe around 1.3 from 2007 to early 2024, trading SPY itself. Price only counts as moving once it leaves the "noise area": the average distance from the open at that time of day over the last 14 sessions, widened by any overnight gap. Entries happen on half-hour checks; the position exits when price falls back inside the band or crosses VWAP, and is flat at the close. Unlike the crossover, it waits for an unusually large move, so it trades less and each trade should carry more of a move relative to the spread. Most of the reported gains come from big trend days, which suits bought options well.

The question is whether the move outruns what the option charges for it. The paper trades shares, with no theta.

**Grid (144):** checks every 10/15/30 minutes × band multiplier 1/1.5 × exits (band and VWAP as in the paper, VWAP only, band only) × 0DTE/1DTE × ATM/ITM1 × no target or +100%. Entries from 30 minutes after the open until 30 minutes before the close, flat 5 minutes before the close, no premium stop. 20 warmup days, so the 14-day band is ready at the start of each chunk.

**Expectation:** The best idea on paper. On 2024–2026 data with option costs, maybe break-even. The share version's edge is around 0.1–0.2% a day, and an ATM 0DTE option costs about that in theta per hour.

**Check:** For two weeks of March 2025 on all three tickers, the engine's breakout signals match an independent recomputation from the raw bars exactly (54 of 54).

**Result** (`runs/2026-11-15T07-54-45-sweep-02-noise-breakout`): clearly better than the crossover, but not an edge. 99 of 144 configs were profitable (median t 0.25 vs −1.64 for the baseline), but the best t was 1.5 and 0 configs passed. Only 5 were positive on all three tickers. QQQ carries everything: median QQQ +$2,711, SPY +$16, IWM −$1,597. 2026 (Jan–Apr) was negative for most configs. The paper's own settings (30-minute checks, band ×1, band-or-VWAP exit) came out around zero, with IWM at t ≈ −2. What helped on average: 10-minute checks, a wider band (×1.5), exiting on VWAP only, 0DTE.

So the effect looks real on QQQ and weak to absent on SPY and IWM over 2024–2026, at least once theta and spread are paid.

### 3. Last-half-hour intraday momentum (Gao, Han, Li and Zhou, 2018)

**Why:** "Market Intraday Momentum" (Journal of Financial Economics) finds that SPY's return from the previous close to 10:00 predicts its return over the last half hour, and the effect is stronger on volatile days. It trades once a day for 30 minutes, so the cost is a single round trip and 30 minutes of theta, and the signal is unrelated to ideas 1 and 2.

**Grid (192):** measured from the previous close or the open × measured over the first 30/60 minutes × enter 30/60 minutes before the close × minimum early move 0/0.25%/0.5% × 0DTE/1DTE × ATM/ITM1 × exits (hold to 2 minutes before the close, or that plus a +50% target).

**Expectation:** Weak. The effect is mainly documented before 2013, and late-day 0DTE options are cheap in dollars but expensive as a share of the move. It's a cheap test with a strong outside prior.

**First result, before the fill fix below:** 56 of 192 profitable, median t −1.16, best t 3.3, and 2 configs passed the development rule. Everything that worked sat in one cluster: measured from the **open** (not the previous close, which is what the paper uses), 0DTE, ATM, with a +50% target. All 12 configs in that slice were profitable. Holding to the close lost money, and the +50% target hit 57–63% of the time.

### Fill fix: exits triggered by a price filled on the triggering print

While checking idea 3, I found an optimistic bias in the simulator. A profit target or stop fires on one of the four prices replayed from an option's 1-minute bar, and the exit filled on that same print. For a target, that's often the bar's high, so a 0DTE option that spikes through the target sells at the top of the spike. A real order sent in reaction can only fill on a later trade.

Now these exits (pnlStop, profitTarget, trailingStop) fill at the next print, and never better than the triggering one. This is the conservative choice; a resting limit order at the target would sometimes do better. Exits decided at a bar close (indicator breaks, opposite signal, flat at the close) and all entries are unchanged: they already fill on the first trade after the decision. The end-to-end test fixture shows the difference directly: the target used to sell at the 1.60 spike, and now sells at the 1.55 that followed.

This only makes results worse, so it doesn't break the rule against tuning the cost model. Ideas 1–3 were rerun with it.

**Reruns with the fix:**

| Idea                   | Profitable        | Median t | Best t | Positive on all 3 | Pass      |
| ---------------------- | ----------------- | -------- | ------ | ----------------- | --------- |
| 1. Crossover           | 6 / 288 (was 33)  | −2.34    | 0.15   | 0                 | 0         |
| 2. Noise-area breakout | 77 / 144 (was 99) | 0.06     | 1.20   | 3                 | 0         |
| 3. Late momentum       | 29 / 192 (was 56) | −1.95    | 2.45   | 10                | 0 (was 2) |

The fix mostly hurt configs with a profit target, which means much of the targets' apparent value (including the "+50% target helps" finding from the SPY grid) was the fill bias. In idea 3, the +50% cluster fell from t ≈ 3.2 to ≈ 1.9. What's left at the top is holding to the close, which the fix doesn't touch: **open · m30 · last60 · 0.5% · 0DTE · ATM · hold** (327 trades, +$5,128, t 2.5; positive on IWM, QQQ and SPY at t 0.9/1.7/1.6). It narrowly fails the rule on 2024 (−$207), and most of its money came in 2025 (+$5,202). Idea 2 still only works on QQQ.

### 4. Opening-range breakout

**Why:** Breakouts of the first 5–30 minutes' range are the other classic intraday momentum setup. Zarattini and Aziz (2023) report strong results for a 5-minute opening range on QQQ. Like idea 2, it waits for a decisive move, but it trades at most once or twice a day and keeps a natural stop at the other side of the range.

**Grid (216):** opening range 5/15/30 minutes × first breakout only or every breakout × stop (back through the other side of the range, through VWAP, or none) × +50%, +100% or no target × entries until 11:30 or until 15:30 × 0DTE/1DTE. 5-minute bars, ATM, flat 5 minutes before the close.

**Expectation:** Similar to idea 2: positive on QQQ, weak elsewhere.

### 3b. The shape of the late-momentum result

**Why:** Idea 3's best config is one point in a coarse grid. If the effect is real, nearby settings should also work: measuring over 15–60 minutes, entering 30–120 minutes before the close, with a range of minimum early moves. If only one point works, it's luck. This is a check of robustness, not a new idea, but every config counts toward the total.

**Grid (200):** measured from the open over 15/30/45/60 minutes × enter 30/45/60/90/120 minutes before the close × minimum move 0.25/0.4/0.5/0.75/1% × hold to the close or a +100% target. 0DTE, ATM.

**Expectation:** A broad region positive on all three tickers if the effect is real; mostly negative, with scattered positives, if not.

### 5. Late entry on days that are outside the noise band

**Why:** Idea 3's survivor needs an early move of at least 0.5%, the same threshold for all three tickers, even though IWM moves more than SPY. Idea 2's noise band normalizes by each ticker's own typical move at that time of day. This combines the two: on the late-day bar, if price is outside the band (an unusual day so far), buy in that direction and hold to the close. It tests whether "trend days keep trending into the close" is the effect behind idea 3, measured more fairly across tickers. It uses the whole day's move, not just the first 30 minutes.

**Grid (48):** the first 5-minute bar outside the band in a 15-minute window from 14:30, 15:00 or 15:30 × band ×0.5/×1/×1.5/×2 × 0DTE/1DTE × hold, or exit on a close back through VWAP. ATM, one entry per ticker per day, flat 2 minutes before the close.

**Expectation:** If idea 3 is real, this should be at least as good and more even across tickers.

### 3c. Does the late-momentum result depend on direction?

**Why:** On a day that moved at least 0.5% by 10:00, a 0DTE option bought at 15:00 might pay off simply because big-move days keep moving (the option is underpriced for that day's volatility), whichever way you bet. If betting against the early move also makes money, the signal isn't about direction. If it loses, the direction is doing the work.

**Grid (12):** with or against the early move × minimum move 0.4/0.5/0.75% × hold or +100% target. Measured from the open over 30 minutes, entry at 15:00, 0DTE, ATM.

**First results for 4, 3b, 5 and 3c (all superseded by the expiry fix below; final numbers are further down):**

- **4:** no edge (best t 1.1). Only the 15-minute range was positive; the 5- and 30-minute ranges on either side were clearly negative, which looks like luck.
- **3b:** entering 60 minutes before the close was positive for 17 of 20 settings, while entering 90–120 minutes before was negative almost everywhere. Higher minimum moves did better.
- **5:** weaker than 3 (best t 1.6). Again only the 15:00 entry worked.
- **3c:** betting against the early move lost on every setting (t −1.0 to −3.5), so the direction is doing the work.
- **Idea 3's previous-close version (the paper's actual signal)** lost on all 96 configs (median t −2.4).

The one config to pass the development rule was **open · m30 · last60 · 0.5% · 0DTE · ATM · +100% target** (t 2.9). While checking it with a single continuous run, the numbers didn't match the sweep (298 trades vs 327), which led to the next fix.

### Fix: expiring options that couldn't be sold were held forever

When the 15:58 exit for a 0DTE option found no trade within 5 minutes (common for cheap IWM contracts at the close), the order was rejected. The option then expired with nothing left to sell it on, so the position stayed open for the rest of the run. Its loss was never booked, and it took up one of the three position slots, blocking later entries (29 "blocked by maxPositions" in the continuous run). The sweep was hit less only because each chunk starts fresh. Stuck positions are mostly worthless options, so this flattered results.

Now, when a close on an option's expiry day finds no trade, it settles at intrinsic value from the underlying's last price, which is what expiry pays, minus the modeled half-spread. A test covers it. The sweep also now counts days that end with a position still open and prints a warning, so this can't hide again. Everything was rerun with the fix.

**On cost levels:** fills round to the cent against the trader, so with a $0.01 minimum spread a cheap option already pays a full cent each way, and a $0.02 minimum gives identical fills. The protocol's stress test (2% spread) only bites on options above $0.50. For a genuinely harsher check, the candidates are also run at a $0.04 minimum spread (two cents each way), for information only.

**Final development results, with both fixes** (each sweep rerun under the same names, latest run folder):

| Idea                           | Configs | Profitable | Median t | Best t | Positive on all 3 | Pass                  |
| ------------------------------ | ------- | ---------- | -------- | ------ | ----------------- | --------------------- |
| 1. EMA9/VWAP crossover         | 288     | 6          | −2.37    | 0.13   | 0                 | 0                     |
| 2. Noise-area breakout         | 144     | 77         | 0.06     | 1.21   | 3                 | 0                     |
| 3. Late momentum               | 192     | 29         | −1.95    | 2.44   | 9                 | 0                     |
| 3b. Late-momentum surface      | 200     | 94         | −0.09    | 2.84   | 23                | 1                     |
| 3c. With vs against            | 12      | 6          | 1.81     | 2.84   | 6                 | 1 (same config as 3b) |
| 4. Opening-range breakout      | 216     | 53         | −0.75    | 1.07   | 6                 | 0                     |
| 5. Late entry outside the band | 48      | 14         | −0.76    | 1.56   | 5                 | 0                     |

The fix barely moved the late-momentum results (327 → 328 trades). A few 1DTE configs still end some days holding a position. That's expected: an option that couldn't be sold at the close carries overnight and sells the next morning.

## Frozen candidates (2026-11-15, before any holdout run)

1,100 configs tried in total. Only one passed the development rule, so it's the only formal candidate.

**C1 — `configs/late-momentum-c1.json`:** on each of SPY, QQQ and IWM, measure the move from the open to 10:00. If it's at least 0.5%, buy the 0DTE ATM option in that direction on the bar closing at 15:00. Sell at +100%, otherwise 2 minutes before the close.

| Development, continuous run           | Trades | Net     | t    | SPY     | QQQ     | IWM   |
| ------------------------------------- | ------ | ------- | ---- | ------- | ------- | ----- |
| Primary costs                         | 328    | +$4,006 | 2.84 | +$1,770 | +$1,780 | +$457 |
| Stress (2% spread)                    | 328    | +$3,869 | 2.76 | +$1,744 | +$1,694 | +$432 |
| Two cents each way (information only) | 328    | +$3,590 | 2.53 | +$1,718 | +$1,596 | +$277 |

By year: 2024 +$90, 2025 +$2,998, 2026 (Jan–Apr) +$918. The continuous run matches the sweep exactly.

**C2 — `configs/late-momentum-c2.json` (information only; it failed the development rule on 2024, −$208):** the same, but held to 2 minutes before the close. Development: +$5,127, t 2.44.

**Holdout pass (unchanged from the protocol):** positive on at least 2 of 3 tickers, combined t ≥ 2, and not negative at stress costs.

**Reading the result:** the best of 1,100 configs having a development t of 2.8 is roughly what luck alone produces, so the development numbers alone prove little. About 6 months of holdout at this trade rate gives roughly 60–80 trades. Even with a real edge the size of the development result, a t of 2 on so few trades is far from certain, so a fail would not disprove the idea. A pass would be meaningful.

## Holdout (2026-05-01 → 2026-11-13, run once, 2026-11-15)

|                                | Trades | Net     | t    | SPY       | QQQ          | IWM        | Max DD |
| ------------------------------ | ------ | ------- | ---- | --------- | ------------ | ---------- | ------ |
| **C1**, primary costs          | 86     | +$2,056 | 2.67 | +$221 (8) | +$1,734 (41) | +$101 (37) | $303   |
| C1, stress (2% spread)         | 86     | +$1,989 | 2.60 | +$212     | +$1,682      | +$95       | $308   |
| C1, two cents each way         | 86     | +$1,857 | 2.41 | +$204     | +$1,660      | −$7        | $321   |
| C2 (information only), primary | 86     | +$3,082 | 1.64 | +$125     | +$2,988      | −$31       | $383   |

Trade counts per ticker are in brackets. **C1 passes the holdout rule:** positive on all 3 tickers (2 required), t 2.67 (≥ 2 required), and positive at stress costs.

Concentration checks: without its 5 best trades C1 still made +$933. Six of seven months were positive (May +$136, Jun +$772, Jul +$451, Aug −$216, Sep +$199, Oct +$235, Nov 1–13 +$479). Puts made +$1,731 and calls +$325. The average entry price was $0.86, so one contract risks under $100.

Caveats are in `SUMMARY.md`. Holdout outputs (summary and trades) are in `outputs/holdout-c1-*`.

## Idea 6: does the direction hold in 2016–2023 stock data? (written 2026-11-15, before running)

The options test can't go before February 2024, but C1's direction call needs only stock prices. This checks it on 2016-01-04 → 2023-12-29 (2,012 trading days per ticker, never used before), with shares instead of options. No costs: the question is only whether the direction is right more than chance.

**Primary test, C1's frozen rule exactly.** For each ticker-day:

- Session open = the open of the first regular-session 1-minute bar.
- Move = close of the last 1-minute bar before open + 30 minutes, over the session open, minus 1. Trade only if |move| ≥ 0.5%.
- Entry = price at close − 60 minutes (the last 1-minute close before it). Exit = price at close − 2 minutes. Early-close days use their own close.
- Signed return r = sign(move) × (exit / entry − 1).

SPY, QQQ and IWM often move together, so ticker-days on the same date aren't independent. Combined statistics average r across the tickers that traded each date, then take a t-stat across dates.

**Pass rule:** combined mean > 0 with day-clustered t ≥ 2; mean positive on ≥ 2 of 3 tickers; mean positive in ≥ 5 of 8 years. If it fails, the options result is probably luck.

**Information only (not part of the pass):** entry at close − 120/90/60/30 minutes × measure 15/30/60 minutes × minimum move 0.25/0.5/1% (36 settings), the previous-close reference from the paper, the same rule on 2024-02 → 2026-11 (the options period) for comparison, and bullish vs bearish days separately.

### Result (run once, 2026-11-15): **FAIL**

| C1 rule, shares, no costs | Ticker-days | Mean    | Hit   | Day-clustered t | SPY      | QQQ     | IWM     |
| ------------------------- | ----------- | ------- | ----- | --------------- | -------- | ------- | ------- |
| **2016–2023 (fresh)**     | 1,153       | −2.0 bp | 49.9% | −0.64           | −7.1 bp  | −1.8 bp | −0.7 bp |
| 2024-02 → 2026-11         | 416         | +6.9 bp | 55.8% | 1.49            | +11.8 bp | +8.7 bp | +4.2 bp |

Pass rule: t −0.64 (needs ≥ 2), 0/3 tickers positive (needs 2), 3/8 years positive (needs 5). It isn't close: over eight years, the 10:00 direction called the last hour right 49.9% of the time.

- The script finds 416 signals on the options period against the engine's 414 trades, so it's measuring the same rule. The effect is visible there in shares too (+6.9 bp, t 1.5), but not in the eight years before.
- Up and down days both fail on 2016–2023. The puts that carried the options holdout had no edge before 2024 either (−3.2 bp).
- The paper's version (previous close → 10:00 predicting the last 30 minutes) is also flat on 2016–2023: −0.4 bp, t −0.65, with 2021 and 2022 clearly negative.
- None of the 36 grid settings reaches t 2. The best is +5.3 bp, t 1.63 (entry at close − 120, measure 15 minutes, ≥ 0.5%), and is one of 36. There's nothing special about 15:00 in the long sample.

Conclusion: C1's edge is most likely specific to 2024–2026, or luck. The options holdout was a genuine out-of-sample pass, but it was 86 trades in the same two-and-a-half-year regime the rule was found in. Eight earlier years show nothing. Output: `outputs/06-stock-momentum.out`.

---

# Part 2: daily ETF rotation (written 2026-11-15, before any data was downloaded or run)

Part 1 searched intraday options for an edge and found none that survived. Part 2 tests a different kind of strategy: monthly rotation between ETFs, held for weeks. The point is to test rules that are already published with fixed parameters, not to search for new ones. Every parameter below comes from the literature, so there's nothing to tune, and all of 2017–2026 is after the papers were published. That makes the whole period out of sample, and there's no separate holdout.

## Setup

- **Data:** Alpaca daily SIP bars, adjusted for splits and dividends, from 2016-01-04. Before using them, check that the daily open and close match the regular-session open and close built from the 1-minute bars for SPY, QQQ and IWM.
- **Period:** decisions from the end of February 2017, which is the first month-end with 12 months of history behind it, to 2026-11-13.
- **Trading:** decide on the close of the last trading day of each month, and trade at the next day's open. Fractional shares. Uninvested money sits in BIL (T-bills).
- **Costs:** primary 5 bp of traded value per side; stress 15 bp. Alpaca charges no commission, so this stands in for spread and slippage.
- **Universes:**
  - _Asset classes (10):_ SPY, IWM, EFA, EEM, TLT, IEF, GLD, DBC, VNQ, plus BIL as cash.
  - _Sectors (9):_ XLB, XLE, XLF, XLI, XLK, XLP, XLU, XLV, XLY, the original Select Sector SPDRs.

## Rules (4 rules × 3 lookbacks = 12 configs)

Each rule runs at its published lookback (marked ★), plus two others as a stability check, not as a choice.

1. **Trend (Faber 2007):** SPY, EFA, IEF, DBC, VNQ at 20% each. Hold an asset only while its close is above its N-day average, otherwise that 20% sits in cash. N = 100, 150, 200★.
2. **Dual momentum (Antonacci 2014):** hold whichever of SPY or EFA has the higher return over the lookback. If that return doesn't beat BIL's, hold AGG instead. Lookback = 6, 9, 12★ months.
3. **Asset-class rotation:** hold the top 3 of the 10 asset classes by lookback return, a third each. Any pick whose return doesn't beat BIL's sits in cash. Lookback = 6, 9, 12★ months.
4. **Sector momentum:** hold the top 3 sectors by lookback return, skipping the latest month (the usual "12-1" momentum). Lookback = 6, 9, 12★ months.

Months are 21 trading days.

## Benchmarks (same period, same costs)

- SPY, bought and held.
- 60/40: SPY/IEF, rebalanced monthly.
- Each rule's own universe at equal weight, rebalanced monthly. That's the fair comparison: does the rule add anything over just holding everything it chooses from?

## What counts as working

Ten years can't statistically prove a monthly strategy. The standard error of a Sharpe ratio over ten years is about 0.3. So these criteria ask "did the published rule behave as published?", not "is it proven?".

A rule **works** if, at its ★ lookback, all of these hold:

- its Sharpe (excess over BIL) beats its equal-weight benchmark's;
- its maximum drawdown is smaller;
- both other lookbacks also beat the benchmark's Sharpe;
- it still beats the benchmark's Sharpe at stress costs.

A rule that loses to its benchmark on Sharpe but cuts the drawdown by at least a third counts as **risk control only**. Otherwise it **doesn't add value**. Beating SPY isn't required: 2017–2026 was an unusually strong decade for US large caps, and few diversified strategies beat it. It's reported anyway.

## Part 2 data check

Daily bars for all 21 ETFs cover 2016-01-04 → 2026-11-13, with the same 2,733 dates for each, so nothing was dropped. For SPY, QQQ and IWM I compared the daily bars against the 1-minute bars (`tools/check-daily.mjs`):

- The daily open is the 09:30 opening print.
- The daily close is the official closing-auction price, which shows up in the 16:00 minute bar. It differs from the 15:59 trade by a few basis points on most days, and by more on fast days. That accounts for the close-to-close mismatches.

Both are prices you can trade at, with market-on-open and market-on-close orders. As a further check, SPY's yearly returns match its published total returns: 2020 +18%, 2021 +29%, 2022 −18%, 2023 +26%, 2024 +25%.

One clarification of the setup: "12-1" momentum means the return from 12 months ago to 1 month ago, so the sector rules use `lookbackDays` = 21 × (J − 1) with `skipDays` 21.

## Part 2 result (run once, 2026-11-15)

Suite: `daily/01-rotation.json`, 2017-03-01 → 2026-11-13. Outputs: `outputs/07-rotation-{5,15}bp.out`.

| Rule (★ lookback)     | CAGR  | Sharpe | Max DD | vs its equal-weight benchmark              | Other lookbacks | 15 bp         | Monthly gap vs benchmark | Verdict                            |
| --------------------- | ----- | ------ | ------ | ------------------------------------------ | --------------- | ------------- | ------------------------ | ---------------------------------- |
| Trend 200d            | 6.1%  | 0.544  | −8.7%  | 0.538, −26.2% → drawdown cut by two-thirds | 0.41, 0.62      | 0.488 < 0.535 | −2.4%/yr, t −0.95        | **Risk control only** (see below)  |
| Dual momentum 12m     | 7.5%  | 0.378  | −33.8% | 0.549, −23.6% → worse on both              | 0.41, 0.33      | 0.353 < 0.546 | −0.5%/yr, t −0.22        | **Doesn't add value**              |
| Asset rotation 12m    | 9.2%  | 0.569  | −20.6% | 0.525, −23.0%                              | 0.62, 0.71      | 0.528 > 0.522 | +1.2%/yr, t 0.40         | **Works (by the rule), barely**    |
| Sector momentum 12-1m | 14.6% | 0.702  | −30.3% | 0.654, −36.7%                              | **0.46**, 0.57  | 0.674 > 0.651 | +1.6%/yr, t 0.67         | **Doesn't add value** (not stable) |
| _SPY buy & hold_      | 14.3% | 0.70   | −33.8% |                                            |                 |               |                          |                                    |
| _60/40_               | 9.1%  | 0.65   | −21.2% |                                            |                 |               |                          |                                    |

**Trend:** at 5 bp its Sharpe ties its benchmark's (0.544 vs 0.538), and it loses at 15 bp. The rule as written didn't anticipate a tie. What it clearly did is deliver the same risk-adjusted return as holding all five assets, with a third of the drawdown: −8.7% vs −26.2%, and −34% for SPY, in a decade that included 2020, 2022 and April 2025. The cost was a lot of return: 6.1% a year vs 8.2% for the benchmark and 14.3% for SPY. It sat 32% in T-bills on average, and the 100-day version was clearly worse (0.41).

**Asset rotation** passes every part of the rule. But its edge over equal weight is +1.2% a year with t 0.40, and at 15 bp the Sharpe gap is 0.006. That passes on paper, but it isn't evidence of an edge.

**Overall:** nothing here is statistically distinguishable from holding its own universe at equal weight; every monthly-gap t is under 1. None of the rules beat SPY on return. That's partly the decade: 2017–2026 strongly favored US large caps over everything else these rules rotate into. The one clear, robust effect is trend following's drawdown control, which is what the long published histories also say it does. It's insurance, not extra return.

---

# Part 3: insider buying (data check, 2026-11-15)

Before designing the study: does Alpaca serve price history for companies that later disappeared? Without it, an event study is biased toward survivors. Tools: `tools/check-delisted.ts`, `tools/check-segments.ts`.

- **Mostly yes.** Acquired and failed companies keep their history, and it ends at the right date: TWTR (2022-10-27), ATVI, CELG, LNKD, SIVB (2023-03-09), FRC, EXPR. Bed Bath & Beyond's original history is under its final symbol BBBYQ and ends at delisting ($0.075).
- **Hazard 1: reused tickers mix companies.**
  - `BBBY` is the old company until 2023, then a gap, then Beyond Inc. from 2025-08.
  - `FB` is Facebook until 2022-06-08, then a different security from 2025-06 (volume ~300 a day).
  - `SHLD` is Sears until 2020-11, with stale, zero-volume prints after its 2018 bankruptcy, then a different security.
  - The same company's history also shows up under its current symbol: META carries the full history.

  So looking up a price by the ticker on a filing usually works, but it has to be checked. The plan is to compare the Form 4's reported transaction price with Alpaca's unadjusted close that day, and drop events that don't match.

- **Hazard 2: some failures are missing.** Pre-bankruptcy Hertz (2016–2020) isn't under HTZ (which starts 2021-11), HTZGQ or HTZZ. Missing losers bias results upward. The study has to report what share of events have no usable price data, and run a bound with those events counted as heavy losses.
- **Delisting returns:** when bars end before a planned exit, the last close can be too generous for a bankruptcy. Shumway (1997) puts the average delisting return for performance-related delistings at about −30%. The study needs a rule for this, set in advance.

## Part 3 design (written 2026-11-15, before any insider data was read)

**Hypothesis.** When officers and directors buy their own company's stock on the open market, with their own money, they're acting on what they know about the business. Prices adjust slowly, especially where few people are watching. So stocks bought by insiders should beat the market over the following months.

- **Who's on the other side:** whoever sells to them, without that information.
- **Why it persists:** the stocks are small, costly to trade and lightly followed.
- **Sources:** Lakonishok & Lee (2001), Cohen, Malloy & Pomorski (2012).

The period 2016–2026 is after both papers, so the whole period is out of sample.

**Events.**

- **Filings:** Form 4 filings (not amendments) in the SEC insider data sets, 2016-01 → 2026-09.
- **Transactions:** non-derivative, code P (open-market purchase), shares acquired, by a reporting owner who is an officer or director. Owners who are only 10% holders or "other" are excluded, since they're funds and activists acting on different motives.
- **Size:** at least $10,000 per filing.
- **Event:** an issuer and a filing date with at least one qualifying purchase. A new event for the same issuer is ignored while an earlier one is still being held.

**Prices and checks.**

- **Prices:** Alpaca daily bars, split- and dividend-adjusted for returns, and unadjusted for the checks below.
- **Ticker check:** the issuer's ticker as reported on the filing must have an unadjusted close on the transaction date within ×0.8–1.25 of the filing's average purchase price. Otherwise the event is dropped as a likely ticker mismatch.
- **Tradeability**, using the day before entry:
  - unadjusted close ≥ $2;
  - median daily dollar volume over the previous 21 days ≥ $500k.
- **Costs:** half the Abdi–Ranaldo (2017) spread estimate from the previous 63 days' high, low and close, charged on entry and again on exit. The floor is 5 bp per side and the cap 200 bp.

**Trading.** Enter at the open of the first trading day after the filing date, since filings can arrive after the close. Exit at the close after the holding period. Primary hold: 126 trading days (6 months). Information only: 21 and 63 days.

**Delistings.** If bars end before the exit:

- a position whose last close is under $1, or under half its entry price, exits at 70% of its last close, following Shumway (1997);
- otherwise it exits at the last close, as in an acquisition.

**Measurement.**

- **Portfolio:** a calendar-time portfolio, equal-weighting every open position each day, after costs, compounded to months.
- **Alpha:** regress the monthly return in excess of BIL on IWM's excess return (primary: insider-bought stocks are mostly small), and separately on SPY's.
- **Secondary:** the average return per event over the hold, minus IWM's.

**Missing prices.** Report the share of events whose ticker has no usable bars. Many will be OTC stocks, which Alpaca doesn't cover and you couldn't trade there anyway; some will be listed companies with missing history, like Hertz. I'll look at 20 random unpriced events to estimate the split. Then I'll recompute the event average with the estimated listed-but-missing share counted at −30% relative to IWM.

**Predictions** (direction only, no significance required). If the mechanism is real:

1. clustered buys (at least 2 different insiders buying the same issuer within the 30 days up to the event) beat single-insider events;
2. the lowest dollar-volume third beats the highest third;
3. events with a CEO or CFO buying beat events with directors only.

**Pass rule** (primary hold, after costs):

- monthly alpha vs IWM > 0 with t ≥ 2;
- alpha vs SPY > 0;
- excess over IWM positive in at least 6 of the 10 full years (2016–2025);
- event-average excess still > 0 under the missing-prices bound;
- at least 2 of the 3 predictions hold.

**If it passes:** the portfolio holds hundreds of positions at once, which you can't run. A tradeable version would hold a subset, such as clusters only. That subset would be a new test, and its rule must be chosen before seeing results.

**Change before running (2026-11-15, no results seen yet):** the primary calendar-time portfolio holds each position at its own value since entry, instead of re-equalizing every position daily. Re-equalizing small, illiquid stocks every day overstates returns: it mechanically harvests bid-ask bounce (Blume & Stambaugh 1983). The daily equal-weight version is still reported, for information. Event-average returns include only holds that finished, either complete or ended by a delisting, not ones cut off by the end of the data.

## Part 3 result (run once, 2026-11-15): **FAIL**

Script: `tools/insider-study.mjs`. Output: `outputs/08-insider.out`, plus `08-insider-gross.out` with no costs, for information.

**Coverage.**

- **Filings:** 90,708 qualifying filings. Of these:
  - 2,363 had no ticker, mostly "NONE" from issuers with no traded stock;
  - 4,352 had a ticker with no Alpaca bars;
  - 2,795 had no bar within a week of the trade;
  - 3,622 (4%) failed the price check, meaning a likely ticker mismatch.
- **Events:** after the overlap rule and the $2 and $500k dollar-volume filters, 16,369 six-month events remain.
- **Costs:** the median estimated cost is 0.18% per side, and 0.93% at the 90th percentile.
- **Delistings:** only 7 positions took the delisting haircut.

**Missing prices.** Of 20 random unpriced tickers:

- 17 were OTC stocks, mutual or interval funds, or SPAC units, none of which you can trade through Alpaca's exchange feed;
- 3 were listed companies whose ticker changed or was mistyped on the filing: SMLP (now SMC), HHC (now HHH), and TCMI, which should be TMCI.

None were failed companies, so the bias from missing data looks small. It doesn't matter here anyway: the result is already about zero, and the bound only lowers it.

**Primary result (126-day hold, after costs, each position at its own value):**

|                      | Events | Alpha per month vs IWM      | Alpha vs SPY     | Average per event vs IWM |
| -------------------- | ------ | --------------------------- | ---------------- | ------------------------ |
| **All events**       | 16,369 | **+0.02%** (t 0.20, β 1.04) | −0.42% (t −1.39) | +0.08%                   |
| Re-equalized daily   | 16,369 | +0.16% (t 1.03)             | −0.30%           |                          |
| 63-day hold          | 20,413 | −0.08% (t −0.55)            | −0.52%           | −0.16%                   |
| 21-day hold          | 24,929 | −0.38% (t −2.12)            | −0.81%           | −0.25%                   |
| _No costs, 126 days_ |        | _+0.15% (t 1.24)_           | _−0.29%_         | _+0.86%_                 |
| _No costs, 21 days_  |        | _+0.37% (t 2.08)_           | _−0.07%_         | _+0.47%_                 |

Excess over IWM by year: 2016 +7.4%, 2017 +4.5%, 2018 −1.2%, 2019 +2.0%, 2020 −1.8%, 2021 +2.4%, 2022 −4.5%, 2023 +2.3%, 2024 +1.4%, 2025 +0.5%. That's 7 of 10 positive, and the only part of the rule that passed.

**Predictions:**

| Prediction                   | For                       | Against                   | Holds? |
| ---------------------------- | ------------------------- | ------------------------- | ------ |
| 1. Clusters beat single buys | Cluster −0.07%/mo (2,962) | Single +0.05%/mo (13,407) | No     |
| 2. Low volume beats high     | Lowest third +0.01%/mo    | Highest third +0.10%/mo   | No     |
| 3. CEO/CFO beats directors   | CEO/CFO −0.01%/mo (4,726) | Directors only +0.02%/mo  | No     |

**Pass rule:**

- alpha vs IWM: t 0.20, needs ≥ 2 ✗;
- alpha vs SPY: negative ✗;
- years: 7/10 positive ✓;
- bound: ✗;
- predictions: 0/3 ✗.

**Reading it:** after costs, stocks bought by insiders did exactly what other small caps did (β ≈ 1 against IWM, alpha ≈ 0), and worse than SPY. None of the three "where it should be stronger" predictions holds, so there's no sign of the mechanism either.

The one trace of an effect is before costs and in the first month: +0.37% a month vs IWM, t 2.1. That's consistent with the literature's finding that most of the effect comes early, in small stocks. But it's one of six information-only cuts, and a round trip each month (about 0.36% at the median) wipes it out completely. The published effect may have been arbitraged away since the papers came out, or it may never have been big enough to survive real spreads.

---

# Part 4: calendar effects with a flow mechanism (written 2026-11-15, before any run)

Two hypotheses that trade rarely, in the cheapest instruments to trade, so costs can't decide the result. Both come from published papers, with their published windows, and 2016–2026 is after both were published.

## 4A. Turn of the month

**Hypothesis.** Pensions, payrolls and fund flows pay out and reinvest on a monthly cycle. Institutions raise cash before month-end payouts (selling pressure), and new money is invested at the turn of the month (buying pressure). So equity returns should be high from the last trading day of the month through the third trading day of the next (days −1 to +3), and weak just before.

- **Sources:** Lakonishok & Smidt (1988), and McConnell & Xu (2008), who found the turn of the month carried essentially all of the US equity premium in 1926–2005. Etula, Rinne, Suominen & Vaittinen (2020) link it to institutional cash needs.
- **Who's on the other side:** institutions that must sell for cash on a schedule, regardless of price.

**Measurement.**

- **Data:** adjusted daily bars (official closes) for SPY, QQQ, IWM and EFA, 2016-02-01 → 2026-11-13.
- **Returns:** daily close-to-close, in excess of BIL.
- **Turn-of-month days:** day −1 (the last trading day of the month) and days +1, +2 and +3.
- **Test:** the mean turn-of-month return minus the mean on all other days, with a Welch t-stat.

**Prediction from the mechanism.** The 4 days before the window (−5 to −2) are below the average non-window day.

**Strategy.** Hold SPY from the close of day −2 to the close of day +3 with market-on-close orders, and BIL otherwise. That's 12 round trips a year. Costs are 2 bp per side primary: the closing auction has no spread to cross and Alpaca charges no commission. Stress costs are 5 bp per side.

**Pass rule.**

- **Effect exists:** SPY's difference > 0 with t ≥ 2; the difference positive on at least 3 of the 4 tickers; SPY's difference positive in at least 6 of the 10 full years (2016–2025).
- **Worth trading:** additionally, the strategy's Sharpe at 5 bp beats SPY buy-and-hold's.
- Information only: IEF and TLT, and the prediction above.

## 4B. Pre-FOMC drift

**Hypothesis.** Stocks rise in the 24 hours before scheduled FOMC announcements. The proposed reason is a premium for holding risk into a scheduled resolution of uncertainty, but it's debated. Lucca & Moench (2015) found about +49 bp in 1994–2011, which accounted for a large share of the equity premium. Later papers report it weakened after publication. So this is partly a test of whether a published anomaly survived.

**Measurement.**

- **Data:** 1-minute bars for SPY, QQQ and IWM.
- **Window:** from the price at 14:00 on the trading day before a scheduled announcement (the close of the 13:59 bar) to the price at 14:00 on announcement day, just before the 14:00 statement.
- **Comparison:** the same 14:00 → 14:00 return on every other pair of consecutive trading days.
- **Dates:** the Fed's own calendars, scheduled meetings only, excluding unscheduled and emergency actions (such as March 2020) and any statement not released at 14:00 on a trading day.

**Pass rule.** The mean pre-FOMC return minus the mean non-FOMC 14:00 → 14:00 return > 0 with Welch t ≥ 2 on SPY; positive on QQQ and IWM; positive in at least 6 of the 10 full years (2016–2025). With about 86 events, a full-size 49 bp effect would give a t of about 4, and half that size about 2.

**Information only:** the reaction from 14:00 to the close on announcement day.

The strategy would be 8 round trips a year. Costs at 2 bp per side don't change the verdict either way, so they aren't modeled.

## Part 4 data

FOMC dates come from the Fed's own pages: `fomccalendars.htm` for 2021+ and `fomchistorical<year>.htm` for 2016–2020, parsed by `tools/fomc-dates.mjs`. Announcements are on the meeting's last day.

- Scheduled meetings only: 8 a year, and 7 in 2020, when the March meeting was replaced by the emergency actions of March 3 and March 15.
- That gives 86 announcements from 2016-01 to 2026-10-28, all with a usable 14:00 → 14:00 pair.

## Part 4 result (run once, 2026-11-15)

Script: `tools/calendar-effects.mjs`. Output: `outputs/09-calendar-effects.out`.

### 4A. Turn of the month: **not shown**

| Ticker | Days −1..+3 | Other days | Difference | t     |
| ------ | ----------- | ---------- | ---------- | ----- |
| SPY    | 6.4 bp/day  | 5.1 bp/day | +1.3 bp    | 0.25  |
| QQQ    | 9.0         | 6.9        | +2.1       | 0.31  |
| IWM    | 1.1         | 5.1        | −3.9       | −0.58 |
| EFA    | 2.4         | 3.4        | −1.0       | −0.20 |

- SPY's difference was positive in only 4 of 10 years.
- The "weak before" prediction fails: days −5..−2 were above average on every ticker.
- The strategy (in SPY 19% of days): Sharpe 0.29 at 2 bp and 0.09 at 5 bp, against 0.78 for buy-and-hold.

The effect that McConnell & Xu found in 1926–2005 isn't visible in 2016–2026.

Information only, and post hoc: Treasuries were strong in the days before month-end (IEF days −5..−2 +6.8 bp/day, t 3.5; TLT t 2.7). That fits the known month-end "index extension" buying of long bonds, but it's one of many information-only numbers and wasn't a prediction.

### 4B. Pre-FOMC drift: **passes the pre-registered rule, but it's fragile**

| Ticker | Pre-FOMC (86) | Other days (2,587) | Difference   | t    | Up  | 14:00 → close on the day |
| ------ | ------------- | ------------------ | ------------ | ---- | --- | ------------------------ |
| SPY    | +20.1 bp      | +4.8 bp            | **+15.3 bp** | 2.12 | 62% | −15.1 bp                 |
| QQQ    | +31.2         | +6.4               | +24.8        | 2.42 | 63% | −9.3                     |
| IWM    | +23.4         | +4.0               | +19.3        | 1.68 | 50% | −19.5                    |

SPY by year: 2016 +6, 2017 +1, 2018 +27, 2019 −10, 2020 +48, 2021 −20, 2022 +89, 2023 +19, 2024 +27, 2025 +1 bp. That's 8 of 10 positive.

**Pass rule:**

- SPY: t 2.12, needs ≥ 2 ✓;
- QQQ and IWM: both positive ✓;
- years: 8 of 10 positive, needs 6 ✓.

**PASS**, the first pre-registered test in this log to pass. The size is about a third of Lucca & Moench's 49 bp, consistent with the effect shrinking after publication.

**Robustness** (information only, after seeing the pass; `tools/fomc-robustness.mjs`, `outputs/09-fomc-robustness.out`):

- **Day of week:** FOMC windows are Tuesday 14:00 → Wednesday 14:00. Against non-FOMC Tuesday→Wednesday windows only, the SPY difference shrinks to 9.3 bp (t 1.11), and QQQ's to 18.8 bp (t 1.63). Part of the gap against "all other days" is a weekday effect.
- **Concentration:**
  - Median 10.2 bp vs 8.4 bp on other days.
  - Without the 5 best events: +5.7 bp, t 0.93.
  - Without 2022: +7.7 bp, t 1.12.
  - The best events include 2020-11-05, the day after the presidential election (its window caught the post-election rally), and 2020-04-29, in the COVID rebound.
- **Over time:** the first half (to mid-2021) is +5.4 bp (t 0.57) and the second half +25.1 bp (t 2.46). That's stronger recently, not decaying.
- **After the statement:** SPY gave back 15 bp from 14:00 to the close on announcement days. Whatever the drift is, it's in the hours before the statement, not after.

**Reading it:** the rule was fixed in advance, a single test was run, and it passed. That's real evidence, and the most there's been in this log. But it rests on a few large up days, and much of it disappears against the right weekday comparison. It's best read as "probably still there, smaller than published, and noisy". The size is also small: about 15 bp × 8 = 1.2% a year above T-bills, with the money in the market only 8 days a year. Gross Sharpe, roughly: per-event standard deviation ~1% → annual ~2.8% → about 0.4–0.5, below SPY buy-and-hold's 0.78.
