# Pending Improvements: BTC Stop Loss

**Date:** 2026-02-14
**Context:** Overnight test analysis (06:19 - 16:22 UTC, 74 straddles, -$30 net)

## Completed

- **Grace period reduced** from 60s to 30s — validated: zero false positives expected at 30s threshold (all 11 successes had one-legged windows < 25s)
- **Double-placement guard** — in-flight Set + 5-minute cooldown map prevents re-entry into the same conditionId after cleanup
- **BTC price tracking** — `straddle-btc-monitor` debug events now fire on every one-legged tick, capturing BTC price trajectory for calibration

## Improvement 1: BTC Price-Based Stop Loss Trigger

**Status:** Pending next test run for calibration data

### Problem

The current stop loss monitors the Polymarket order book for a 15-cent price drop on the filled side, but this is a **lagging indicator**. The 5-minute BTC up/down markets resolve based on BTC price movement, so by the time the Polymarket book reflects the move, the damage is already done. With the old 60s grace period, 12 of 16 true one-legged losses triggered at exactly ~60s with exit prices of $0.02-$0.38 (avg $0.22).

### Validation Results (from overnight data)

- **One-legged windows for successes:** median 5s, max 85s — BTC can't move $25+ in 5s
- **Recommended threshold:** $25-30 based on data analysis
- **Grace period:** NOT needed for BTC trigger (clean signal, not noisy like order book)
- **Architecture:** BTC price at entry is now recorded on every straddle, and `straddle-btc-monitor` events capture the full BTC trajectory during one-legged windows

### Next Steps

1. Run overnight test with BTC tracking enabled (this commit)
2. Query `debug-straddle-btc-monitor` events to see BTC deltas at the moment of stop loss trigger vs during successful straddle one-legged windows
3. Set threshold at a value that separates the two distributions cleanly
4. Implement the BTC stop loss trigger in `startStopLossMonitor()` using the calibrated threshold

### Architecture (for implementation)

- Add `btcStopLossThreshold: number | null` to `MarketAdapter` and `Crypto5mAdapter`
- Subscribe to `binanceWsService.ticks$` in `startStopLossMonitor()` alongside existing Polymarket tick subscription
- Fire immediately when `|btcCurrent - btcAtEntry| >= threshold` (no grace period)
- Add `'btc_price'` as a new trigger type in `handleStopLoss()`

## Test Results Reference

**Overnight test (2026-02-14 06:19 - 16:22 UTC):**
- 74 straddles placed, 27 active (had fills), 47 ghost (no fills or no completion event)
- 16 true one-legged losses totaling $35.80 (avg $2.24 each)
- 11 near-complete successes (both sides ~filled, tiny residual cleaned up)
- ~14 ghost successes (user claimed $140 in winnings manually)
- All 16 one-legged triggers were `price_drop`, fired at avg ~65s elapsed
- Exit prices ranged from $0.02 to $0.38 (avg $0.22)
- Entry conditions were identical across successes and failures (bids 0.40/0.59, spreads 0.01)
- BTC velocity at entry does NOT predict one-legged outcome
