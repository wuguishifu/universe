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
