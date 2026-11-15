# Overnight research summary (2026-11-15)

## Update: the 2016–2023 stock test failed

The direction check recommended below (step 1) has been run, and it **fails**. On eight years of fresh stock data, C1's rule called the 15:00 → 15:58 direction right 49.9% of the time: mean −2.0 bp, day-clustered t −0.64, negative on all three tickers and in 5 of 8 years. The same script shows the effect in 2024–2026 (+6.9 bp, t 1.5), so the options result is most likely specific to that period, or luck. Don't pay for data or paper-trade on the strength of C1. Details are in `LOG.md`, idea 6.

The original verdict follows, unchanged.

## Verdict (before the stock test)

**One strategy passed the held-out test, the first positive evidence so far. It's worth a cheap forward test, not real money yet.**

The original EMA9/VWAP crossover has no edge on SPY, QQQ or IWM. It's dead. Of five strategy ideas and two follow-up checks (1,100 configs), exactly one config passed the development rule. Frozen before the holdout was ever run, it also passed the holdout.

## The strategy (C1, `configs/late-momentum-c1.json`)

On each of SPY, QQQ and IWM:

1. Measure the move from the open to 10:00.
2. If it's at least 0.5% either way, buy the 0DTE ATM option in that direction (a call if up, a put if down) on the 5-minute bar that closes at 15:00.
3. Sell at +100% of the premium, or otherwise 2 minutes before the close.

That's at most one trade per ticker per day. In development it traded on about one ticker-day in five: 328 trades over 563 days × 3 tickers. SPY rarely moves 0.5% by 10:00, so most trades are QQQ and IWM. The average premium was $0.86, so one contract risks under $100.

|                                   | Trades | Net         | t        | SPY       | QQQ         | IWM       |
| --------------------------------- | ------ | ----------- | -------- | --------- | ----------- | --------- |
| Development, Feb 2024 – Apr 2026  | 328    | +$4,006     | 2.84     | +$1,770   | +$1,780     | +$457     |
| **Holdout, May – Nov 13 2026**    | **86** | **+$2,056** | **2.67** | **+$221** | **+$1,734** | **+$101** |
| Holdout, stress costs (2% spread) | 86     | +$1,989     | 2.60     |           |             |           |
| Holdout, two cents each way       | 86     | +$1,857     | 2.41     |           |             |           |

With 1 contract per trade. Holdout max drawdown $303. Development max drawdown $1,707.

### Why I believe it a little

- **The holdout was clean.** The candidate was frozen and written down before the holdout was run, and the holdout ran once. QQQ and IWM data from May 2026 on had never been looked at.
- **It's a broad region, not a single point.** With entry at 15:00, 17 of the 20 nearby settings were profitable: measuring over 15–60 minutes, with minimum moves of 0.25–1%. The nearest neighbors (0.4% and 0.75% minimum moves) had t 1.8 and 2.2, and the other measuring windows were positive but weaker (t mostly 0.8–1.6) (`LOG.md`, idea 3b).
- **The direction matters.** The same entries taken _against_ the early move lose on every setting (t −1 to −3.5). So it's a momentum effect, not just owning an option on a volatile day.
- **Costs barely matter,** since it trades at most once a day per ticker. At two cents each way it still made +$1,857 on the holdout.
- **The profit is spread out.** Six of seven holdout months were positive, and it's still positive without the 5 best trades.
- **It has a published relative.** Intraday momentum, where the early move predicts the last half hour, is in Gao, Han, Li and Zhou (2018).

### Why it could still be nothing

- **1,100 configs were tried.** The best development t of 2.8 is about what luck alone would produce. The holdout is the only real evidence, and it's 86 trades over six months in one market regime.
- **The entry time is oddly specific.** Entering at 15:00 works; entering at 14:00 or 14:30 loses almost everywhere. I don't have a good explanation, and an effect that only exists at one clock time is a classic sign of overfitting.
- **It doesn't match the paper.** The published version measures from the _previous close_, and that version lost on all 96 configs here. The version that works measures from today's open, which I found by searching.
- **QQQ does most of the work.** IWM is marginal (holdout +$101, slightly negative at two cents each way) and SPY rarely trades. Most of the holdout profit came from puts.
- **Fills are modeled, not real.** Alpaca has no historical option quotes, so the spread is assumed. The 15:00 entry and the 15:58 exit on a 0DTE option are exactly where real fills could be worse than modeled.
- **The money is small.** About $4k a year at one contract per ticker. Sizing up multiplies the drawdowns too.

## Before paying $99/month

1. **Test the direction signal on ten years of stock data, for free.** The directional part doesn't need options. Alpaca has stock bars back to 2016. Check whether, on days when SPY/QQQ/IWM moved ≥ 0.5% from the open by 10:00, the 15:00 → 15:58 move went the same way more often than chance, for 2016–2023. That's a large, completely fresh sample. If the effect isn't there in shares, the options result is probably luck. This is the next thing I'd build: download `--from=2016-01-01` stock bars only, plus a small script.
2. **Check real spreads.** For a couple of weeks, note the bid/ask of the ATM 0DTE QQQ and IWM options at 15:00 and 15:58, or watch the chain live. If they're within a cent or two, the cost assumptions hold.
3. **Then forward-test it.** This strategy needs the stock price at 10:00 and 15:00, and can place its +100% target as a resting limit order. It may not need streaming option quotes at all. As far as I know, Alpaca's free plan includes real-time IEX stock data, which may be enough for the signal (check current plans). A month or two of paper trading at one contract would show whether live results track the model.

If step 1 fails, stop there. If it passes and spreads look right, this is a reasonable candidate to paper-trade.

## Two simulator bugs found and fixed tonight

Both made results look better than they were. Everything was rerun with the fixes, and **results from earlier sessions (the SPY grid, the existing configs) predate them**, so treat those numbers as optimistic.

1. **Price-triggered exits filled on the triggering print.** A profit target that fired on a one-minute spike sold at the top of the spike. Now pnlStop, profitTarget and trailingStop fill on the next print, and never better than the trigger. Much of the "+50% target helps" finding from the SPY grid was this bias.
2. **Expiring options that couldn't be sold were held forever.** If nothing traded when a 0DTE option's closing order went out, the position stayed open for the rest of the run: its loss was never booked and it blocked a position slot. Now it settles at intrinsic value on expiry day. Sweeps now also warn if any config ends a day with a position still open.

## What changed in the code

**Core (`projects/trading/core`), all with tests (82 passing):**

- Indicators:
  - `price`: price as an indicator.
  - `openingRange`: high/low of the first N minutes.
  - `noiseBand`: the Zarattini–Aziz–Barbon noise area.
- Signals:
  - `breakout`: price leaves a band, with options `maxPerSession` and `whileOutside`.
  - `timedMomentum`: early move → late entry.
  - Signals now receive the bar's `Clock`.
- Entry filter `indicatorSide`: trade only in the direction two indicators agree on. Entry filters now see the bar's indicator values.
- `indicatorBreak.bearishIndicator`: a different indicator for puts, e.g. the lower edge of a band.

**Backtest (`projects/trading/backtest`), 30 tests passing:**

- Sweeps:
  - Chunks never span a new year, and results are broken down per year and per ticker.
  - `results.jsonl` holds full results for analysis.
  - `rankBy: tStat` is available.
  - A warning prints when any config leaves positions open.
- Stats: a per-ticker breakdown, and t-stats in each breakdown.
- The two fill fixes above.

**Research (`research/`):**

- `LOG.md`: every idea, written down before its run, with results and the running config count.
- `sweeps/`: the sweep files.
- `outputs/`: sweep printouts and the holdout results.
- `tools/`:
  - `analyze.mjs`: per-ticker, per-year and pass-rule view of a sweep's `results.jsonl`.
  - Two scripts that independently recompute the signals from raw bars. Both matched the engine exactly.

Nothing is committed.

## Reproduce

```sh
cd projects/trading/backtest
nx run trading-backtest:backtest --config=configs/late-momentum-c1.json                          # development
nx run trading-backtest:backtest --config=configs/late-momentum-c1.json --from=2026-05-01 --to=2026-11-13   # holdout
nx run trading-backtest:sweep --config=research/sweeps/03b-late-momentum-surface.json
node research/tools/analyze.mjs runs/<sweep folder> 20 tStat
```
