# Stop Loss Investigation: One-Legged Straddle Losses in 5-Minute Markets

**Date:** 2026-02-14
**Test Window:** 01:21:00 - 04:22:00 UTC
**Adapter:** crypto-5m (BTC up/down 5-minute markets)

## Problem Statement

The current time-based stop loss (200 seconds) does not prevent catastrophic losses on one-legged straddles in the 5-minute market. The strategy is net negative despite a ~79% success rate because the 5 true one-legged losses (~15%) each cost 7-11x more than a single successful straddle earns.

## Test Results Summary

### Outcomes (33 straddles placed)

| Outcome | Count | % | P&L Impact |
|---|---|---|---|
| Both legs filled (clean) | ~18 | 55% | +$1.00 each |
| Near-complete (tiny residual cleaned by stop loss) | 8 | 24% | +$1.00 each (residual loss negligible) |
| **True one-legged (full 20 shares lost)** | **5** | **15%** | **-$7.60 to -$11.40 each** |
| Unknown/incomplete | 2 | 6% | Unknown |

### P&L Estimate

- **Successful straddles:** ~26 x $1.00 = **+$26.00**
- **True one-legged losses:** 5 trades at full loss = **-$53.20**
- **Net P&L: approximately -$27.20**

### The 5 Catastrophic Stop Losses

| Time | Condition (short) | Filled Side | Entry Price | Shares | Capital Lost |
|---|---|---|---|---|---|
| 01:59 | 0xa1ad | NO @ $0.57 | $0.57 | 20 | $11.40 |
| 02:06 | 0xf1d6 | NO @ $0.38 | $0.38 | 20 | $7.60 |
| 03:05 | 0x87c6 | YES @ $0.57 | $0.57 | 20 | $11.40 |
| 03:43 | 0x9852 | NO @ $0.57 | $0.57 | 20 | $11.40 |
| 04:09 | 0x01eb | YES @ $0.57 | $0.57 | 20 | $11.40 |

Note: `exitPrice` was not captured in production during this test (feature not deployed). Losses assume full capital loss since by the time the 200s timer fires the market has likely resolved or the losing side is near $0.

### Pattern Observed

In 4 of 5 true one-legged cases, the **more expensive side ($0.57)** filled while the cheaper side ($0.38) did not. The expensive side is closer to the market and fills easily. The cheap side needs a significant price move in its direction — if the market moves away, it never fills and the expensive side loses value rapidly.

## Root Cause Analysis

### Why the 200-Second Timer Fails

The crypto-5m adapter allows straddle placement when **0:30 to 4:30 remain** in the market. The stop loss timeout is **200s (3:20)**.

| Time Remaining at Entry | Stop Loss Fires With... | Market Status |
|---|---|---|
| 4:30 remaining | 1:10 remaining | Open, but outcome likely determined |
| 3:20 remaining | 0:00 remaining | Exactly at resolution |
| 2:00 remaining | 1:20 after close | **Already resolved** |
| 0:30 remaining | 2:50 after close | **Long resolved** |

For any straddle placed with <3:20 remaining, the stop loss fires **after the market has resolved** and the losing side is worth $0. Even for straddles placed earlier, the BTC price movement that determines the outcome is already established well before the stop loss fires.

### The Fundamental Asymmetry

- **Profit per successful straddle:** (1.0 - 0.95) x 20 = **$1.00**
- **Loss per one-legged straddle:** ~$0.57 x 20 = **$11.40** (worst case)
- **Break-even ratio:** Need **~11 successes per 1 failure**
- **Observed ratio:** 26 successes / 5 failures = **5.2:1** (not enough)

## Current Architecture Context

### Key Files

| File | Role |
|---|---|
| `src/modules/strategy/components/straddle-manager.service.ts` | Stop loss timer, fill handling, cleanup |
| `src/modules/strategy/components/alpha.service.ts` | Entry filters and plan generation |
| `src/modules/strategy/strategy.service.ts` | Orchestrates entry pipeline |
| `src/modules/clob/ws/market-ws.service.ts` | Real-time order book + trade events |
| `src/modules/market-adapter/crypto-5m.adapter.ts` | 5-min market config |

### Available Real-Time Data

The system currently has access to (via Polymarket WebSocket):
- **Order book snapshots** (`book` events): full bid/ask levels per asset
- **Price change events** (`price_change`): incremental order book updates
- **Trade events** (`last_trade_price`): individual trade executions with side, price, size
- **Computed aggregates**: bestBid, bestAsk, totalBidVolume, totalAskVolume per side

The system does **NOT** currently have:
- External price feeds (Binance, etc.)
- Historical fill-rate data
- Post-placement order book monitoring for active straddles

### How the Stop Loss Currently Works

```
placeStraddle(plan, stopLossTimeoutMs=200000)
  → startStopLossTimer(conditionId, 200000)
    → setTimeout(handleStopLoss, 200000)  // fire-and-forget timer

handleStopLoss(conditionId):
  1. Check if straddle still exists
  2. Check if both sides filled (minSide >= 99% of quantity → skip)
  3. Check if truly one-legged (exactly one side has holdings > 0)
  4. Cancel unfilled side's order
  5. Market-sell filled side's holdings
  6. Track event + cleanup
```

The timer is purely time-based — no price monitoring, no fill-rate awareness, no market microstructure signals.

## Proposed Solutions

### Option A: Price Drop Stop Loss (Reactive)

**Concept:** After placing a straddle, continuously monitor the filled side's price. If it drops below a threshold, exit immediately rather than waiting for the timer.

**Implementation:**
- Subscribe to `marketTicks$` for active straddles in `StraddleManagerService`
- On each tick, check if either side has filled while the other hasn't
- If the filled side's best bid drops below `entryPrice - maxLoss`, trigger stop loss immediately
- Could also trigger if the unfilled side's best ask rises above a threshold (indicating it won't fill at our price)

**Parameters:**
- `stopLossMaxDropCents`: max price drop on filled side before exit (e.g., 3 cents = $0.60 loss on 20 shares)
- `stopLossMonitorDelayMs`: delay before starting to monitor (allow time for natural fill)

**Pros:**
- Exits early when the market moves against us, limiting losses
- Simple to implement — data already available via `marketTicks$`
- Works regardless of where we are in the 5-minute window

**Cons:**
- Could trigger false positives on temporary price dips
- Doesn't prevent the one-legged state from occurring in the first place
- Requires tuning the drop threshold — too tight means many false exits, too loose means big losses

**Estimated Max Loss:** `stopLossMaxDropCents * quantity` (e.g., 3 cents * 20 = $0.60 vs current $11.40)

### Option B: Time-Aware Stop Loss (Improved Timer)

**Concept:** Instead of a fixed 200s timer, tie the stop loss to the market's remaining time. Exit earlier when less time remains for the other side to fill.

**Implementation:**
- Replace `setTimeout` with an interval that checks every N seconds
- At each check, evaluate: is one side filled and the other at 0 fills?
- If yes and `timeRemaining < threshold`, exit immediately
- Could use a tiered approach: gentler early, aggressive near resolution

**Parameters:**
- `stopLossCheckIntervalMs`: how often to check (e.g., 5000ms)
- `stopLossMinTimeRemainingMs`: if one-legged and time remaining < this, exit (e.g., 60000ms = 1 min)

**Pros:**
- Prevents the worst case (stop loss firing after market resolution)
- Simple to reason about and implement

**Cons:**
- Still time-based — doesn't react to price movements
- If the market resolves at exactly 5:00 and we exit at 4:00, we still lose most of the position value because the outcome is largely determined by then

### Option C: Combined Time + Price Drop (Recommended starting point)

**Concept:** Monitor both price and time. Exit if EITHER condition triggers.

**Implementation:**
- Replace the single `setTimeout` with a monitoring subscription to `marketTicks$`
- On each tick for an active straddle:
  1. **Fill check:** Are both sides filled? → clear monitor, straddle is healthy
  2. **Time check:** Is straddle one-legged AND `timeRemaining < minTimeRemainingMs`? → exit
  3. **Price check:** Is straddle one-legged AND filled side's bid dropped > `maxDropCents`? → exit
  4. **Fallback:** Max timer (e.g., 200s) as a safety net

**Parameters:**
- `stopLossMaxDropCents`: price drop trigger (e.g., 2-3 cents)
- `stopLossMinTimeRemainingMs`: time-based trigger (e.g., 60s remaining)
- `stopLossMonitorDelayMs`: grace period before monitoring starts (e.g., 10-30s)
- `stopLossTimeoutMs`: hard fallback timer (keep existing 200s)

**Pros:**
- Catches both scenarios: fast price moves AND slow bleeds near resolution
- Grace period allows normal fill dynamics to play out
- Fallback timer prevents orphaned positions

**Cons:**
- More complex to implement and tune
- Requires careful handling of race conditions between the monitors

### Option D: Binance WebSocket Price Feed

**Concept:** Subscribe to Binance BTC/USDT real-time price feed. Since the 5-minute markets resolve based on BTC price movement, observing the actual BTC price gives a leading indicator of which side will lose.

**Implementation:**
- Add a Binance WebSocket connection (`wss://stream.binance.com:9443/ws/btcusdt@trade` or `@kline_1s`)
- Record BTC price at straddle placement time
- Monitor BTC price movement direction
- If BTC has moved significantly in one direction (indicating one outcome is losing), exit the filled side immediately

**Architecture:**
```
New service: BinancePriceFeedService
  - Connects to Binance WS
  - Exposes observable: btcPrice$
  - Provides: getCurrentPrice(), getPriceAtTime(timestamp)

Modified: StraddleManagerService
  - On straddle placement, record BTC reference price
  - Subscribe to btcPrice$ for active straddles
  - If |currentPrice - referencePrice| > threshold, check if one-legged → exit
```

**Pros:**
- Leading indicator — BTC price moves BEFORE the Polymarket order book adjusts
- Could detect problems seconds before they manifest on Polymarket
- Could also improve entry timing (don't enter when BTC is trending)

**Cons:**
- New external dependency (Binance API)
- Need to determine the relationship between BTC price movement and market outcome thresholds
- Mapping BTC price delta to "up/down" market outcome isn't straightforward without knowing the exact resolution rules
- Added complexity and potential failure mode

### Option E: Historical Data / Fill-Rate Prediction

**Concept:** Use historical data from past straddles to predict which market conditions lead to one-legged outcomes, and avoid entering those conditions.

**What we'd need to analyze:**
- For each straddle: entry conditions (OBI, spread, volatility, time in window) vs outcome
- Build a model: given current conditions, what's the probability of both legs filling?
- Only enter when predicted fill probability exceeds a threshold

**Data collection needed:**
- Track the order book state at placement time (already partially done via debug events)
- Track fill timing (time from placement to first fill on each side)
- Track which side fills first and how quickly

**Query to start analysis:**
```sql
-- Correlate entry conditions with outcomes
SELECT
  p.created_at,
  p.metadata->>'conditionId' AS cid,
  (p.metadata->>'yesPrice')::float AS yes_price,
  (p.metadata->>'noPrice')::float AS no_price,
  CASE
    WHEN sl.id IS NOT NULL AND (sl.metadata->>'holdings')::float > 1 THEN 'one_legged_loss'
    WHEN sl.id IS NOT NULL THEN 'near_complete'
    ELSE 'success'
  END AS outcome,
  (sl.metadata->>'holdings')::float AS sl_holdings,
  (sl.metadata->>'filledSide') AS sl_filled_side
FROM osmium.events p
LEFT JOIN osmium.events sl
  ON sl.name = 'straddle-stop-loss'
  AND sl.metadata->>'conditionId' = p.metadata->>'conditionId'
  AND sl.source = 'iridium'
WHERE p.name = 'straddle-placed'
  AND p.source = 'iridium'
  AND p.created_at BETWEEN '2026-02-14 01:21:00' AND '2026-02-14 04:22:00'
ORDER BY p.created_at;
```

**Pros:**
- Prevents bad entries rather than reacting to bad outcomes
- Could dramatically improve the success rate

**Cons:**
- Needs significantly more data to build a reliable model
- The 5-minute markets may not have enough signal in the order book to predict outcomes
- Risk of overfitting to historical patterns

## Recommendation

**Start with Option C (Combined Time + Price Drop)** because:

1. It addresses the immediate problem (losses from late stop losses) with the data we already have
2. It limits maximum loss per trade to a tunable parameter
3. It doesn't require new external dependencies
4. It can be implemented and tested quickly

**Then consider Option D (Binance feed)** as a second phase, because:
1. BTC price is the actual driver of the market outcome
2. It provides a leading indicator that Polymarket order book data lacks
3. The relationship between BTC price and market outcome could be learned from data

**Option E (historical prediction)** is a longer-term investment that should happen in parallel through data collection.

## Implementation Notes for Option C

### Changes to `straddle-manager.service.ts`

1. Replace `setTimeout` with a subscription-based monitor
2. On `placeStraddle`, create a subscription to `marketTicks$` filtered by conditionId
3. Track entry prices in the straddle object (already available: `yesPrice`, `noPrice`)
4. On each tick:
   - Check fill state (are we one-legged?)
   - If one-legged for the first time, record the "one-legged detected at" timestamp
   - After grace period, evaluate exit conditions:
     - Price drop: `currentBid < entryPrice - maxDropCents/100`
     - Time remaining: `timeRemaining < stopLossMinTimeRemainingMs`
   - If either triggers, execute the existing stop loss logic
5. Keep the fallback `setTimeout` as a safety net

### New Config Parameters

```typescript
// in environment-schema.ts
stopLossMaxDropCents: z.coerce.number().min(0).default(3),          // exit if filled side drops 3+ cents
stopLossMinTimeRemainingMs: z.coerce.number().min(0).default(60000), // exit if <60s remains and one-legged
stopLossMonitorDelayMs: z.coerce.number().min(0).default(15000),     // 15s grace period before monitoring
stopLossCheckIntervalMs: z.coerce.number().min(0).default(2000),     // check every 2s
```

### Data Needed for Tuning

To tune the parameters, we need to capture more data. The `exitPrice` feature should be deployed (even if approximate). Additionally, track:
- Time of first fill on each side
- Price at time stop loss triggers (best bid of filled side)
- Time remaining in market when stop loss triggers

### Potential Issues

- **Race conditions:** Multiple monitors (tick-based + timer) could fire simultaneously. Use a flag (`stopLossTriggered`) to prevent double execution.
- **Subscription cleanup:** Ensure tick subscriptions are cleaned up when straddles complete normally. Use `takeUntil` with a completion signal.
- **Performance:** Subscribing to every tick for every active straddle could create overhead. Consider throttling or using the existing `mergeIntervalMs` pattern.
- **Missing 0x65f4:** During the test, straddle 0x65f4 (placed 02:10, YES filled 20, NO unfilled) has no stop loss event. This could indicate a bug in the timer — investigate whether the timer can be lost (e.g., during WebSocket reconnection or market state cleanup).

## Data Analysis: Price-Drop Stop Loss Feasibility

### Methodology

We analyzed order book data (`debug-book-update` events) for all 33 straddles, sampling every 10 seconds from placement. We compared price trajectories for successful straddles vs one-legged failures to determine if a price-drop threshold can separate them.

### Finding 1: Max Drawdown Over Full Lifetime Is Useless

Query 1 computed `MIN(bestBid)` over the full 5-minute window from placement. **Every single straddle** (success and failure alike) showed 27-57 cent max drawdowns because the market always resolves to YES=$1/NO=$0, driving the losing side to $0. This metric has zero discriminatory power.

### Finding 2: Price Trajectories of the 5 Failures (Filled Side)

Drops on the filled side (in cents) over time:

```
Time(s):     0    10    20    30    40    50    60    80   100   120   150   200
0x01eb(Y57) -1     2     2     3     0    14    16     5     4     2    39    50  ← cliff at 50s, recovery, then crash at 150s
0x87c6(Y57) -2     8    10     7     2     3     2    26    40    41    51    -- ← early 8c signal, cliff at 80s
0x9852(N57) -2    -2    -1     6     7     7     8    21    16     8    10     8  ← oscillating, NO clean signal
0xa1ad(N57) -1     0    11    10    17    17    18    27    29    28    27    45  ← steady decline from 20s
0xf1d6(N38) -2     6     9    15    18    22    23    13    --    --    --    --  ← immediate decline from 10s
```

**Key observations:**
- 4/5 failures show 8-15c drops on the filled side within the first 20-50 seconds
- 0x9852 is anomalous — the filled side oscillates wildly with no clean crash signal
- Crash timing varies dramatically: 10s, 50s, 80s, 160s — no single "safe" window

### Finding 3: Successful Straddles Also Show Large Drops

Max drop on either side within first 90 seconds, by outcome:

```
                     0c   5c   10c   15c   20c   25c   30c
SUCCESS (20):        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░
                     |----mostly here----|  |--outliers--|
NEAR_COMPLETE (8):   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░
ONE_LEGGED_LOSS (5):                  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

SUCCESS distribution:    2c, 3c, 3c, 6c, 6c, 7c, 7c, 8c, 8c, 8c, 8c, 9c, 10c, 11c, 12c, 13c, 20c, 23c, 24c, 29c
NEAR_COMPLETE:           0c, 3c, 7c, 11c, 16c, 18c, 19c, 20c
ONE_LEGGED_LOSS:         16c, 21c, 23c, 27c, 36c
```

**The distributions overlap from 16c-29c.** There is no clean threshold.

### Finding 4: The One-Legged Condition Is the Key Filter

**Critical nuance:** The price-drop data above shows market-wide price movement, NOT whether the straddle was actually one-legged at that moment. The stop loss only fires when:
```typescript
const yesFilled = straddle.yesHoldings > 0;
const noFilled = straddle.noHoldings > 0;
if (yesFilled === noFilled) { return; } // both or neither → skip
```

For successful straddles, **both sides typically have partial fills within seconds**. Even when the market swings 20c, the straddle has holdings on both sides, so the one-legged check (`yesFilled !== noFilled`) would return false. The "false positive" scenarios from the price-drop analysis would largely **never trigger** because the straddle isn't one-legged.

**The effective false positive rate is likely much lower than the raw price overlap suggests.** The worst-case scenarios (0x6b25, 0x75e9, 0x558e showing 20-29c drops) would only be false positives IF those straddles had exactly one side at 0 fills during the drop — which is unlikely given they both filled successfully.

### Finding 5: Selective Failure Price Trajectories

All 5 failures show a consistent pattern when viewed from the unfilled side: the unfilled side's bid **rises** as the filled side's drops, confirming a directional move. This means the unfilled side's order (at our low price) is moving further from the market, making it less likely to fill.

For example, 0xa1ad (NO filled @ $0.57):
```
Time:   0s   20s   40s   60s   80s   100s  120s  160s
NO bid: 0.58  0.46  0.40  0.39  0.30  0.28  0.29  0.15  ← filled side crashing
YES bid:0.40  0.52  0.59  0.60  0.67  0.71  0.69  0.84  ← unfilled side rising away
```

### Threshold Economics (Estimated)

Assuming the one-legged check eliminates most false positives, and only ~1-2 successful straddles would be affected at any threshold:

| Threshold | Failures Caught | Est. False Positives | Savings per TP | Cost per FP | Net vs Baseline |
|---|---|---|---|---|---|
| 10c | 5/5 | ~0-2 | ~$9.40 | ~$3.00 | **+$41 to +$47** |
| 15c | 5/5 | ~0-1 | ~$8.40 | ~$4.00 | **+$38 to +$42** |
| 20c | 4/5 | ~0 | ~$7.40 | ~$5.00 | **+$18** (misses 0x01eb) |

Baseline = -$53.20 from 5 full losses. Even a 10c threshold with 2 false positives saves ~$41.

### Finding 6: One-Legged Window Duration

Query result: for each successful/near-complete straddle, how long was the window where exactly one side had fills and the other had zero?

```
One-legged window durations (seconds):
  0xad02:  205.8s  (NEAR_COMPLETE)   0x8854:  173.0s  (SUCCESS)
  0xf008:  107.3s  (NEAR_COMPLETE)   0x91c4:  106.4s  (NEAR_COMPLETE)
  0x4f6f:   77.9s  (SUCCESS)         0x558e:   61.2s  (SUCCESS)
  0x3510:   53.3s  (SUCCESS)         0xf8f0:   48.6s  (SUCCESS)
  0x3fd7:   42.8s  (SUCCESS)         0xe6b4:   24.0s  (NEAR_COMPLETE)
  0x04db:   21.6s  (SUCCESS)         0x8ef3:   21.0s  (SUCCESS)
  0x4c79:   17.6s  (SUCCESS)         0xced8:   17.4s  (SUCCESS)
  0x8ee4:   16.8s  (NEAR_COMPLETE)   0xb0f0:   14.8s  (SUCCESS)
  0xc509:   14.4s  (SUCCESS)         0x5045:   10.4s  (SUCCESS)
  0x1569:    9.1s  (SUCCESS)         0xa447:    6.7s  (SUCCESS)
  0x214c:    3.7s  (NEAR_COMPLETE)   0xa3f5:    3.5s  (SUCCESS)
  0xe6d1:    2.9s  (NEAR_COMPLETE)   0x8c41:    1.9s  (SUCCESS)
```

**13/24 straddles** have one-legged windows under 30 seconds — these are safe at any threshold because prices don't move 15c in under 30 seconds.

### Finding 7: Cross-Referencing Window Duration with Price Drops

For the 11 straddles with one-legged windows > 30 seconds, checking the max drop on the FILLED side during that window:

| CID | Window | Filled Side | Max Drop During Window | FP at 15c? |
|---|---|---|---|---|
| 0x04db | 22s | NO@$0.57 | ~2c | No |
| 0xe6b4 | 24s | NO@$0.57 | ~0c | No |
| 0x3fd7 | 43s | YES@$0.57 | ~8c | No |
| 0xf8f0 | 49s | NO@$0.57 | ~5c | No |
| 0x3510 | 53s | YES@$0.38 | ~8c | No |
| **0x558e** | **61s** | **NO@$0.38** | **20c at 50s** | **YES** |
| 0x4f6f | 78s | YES@$0.38 | ~8c | No |
| 0x91c4 | 106s | NO@$0.57 | ~10c | No |
| **0xf008** | **107s** | **YES@$0.63** | **20c at 30s** | **YES** |
| 0x8854 | 173s | NO@$0.38 | ~7c | No |
| 0xad02 | 206s | NO@$0.38 | ~0c (stays above entry) | No |

**At 15c threshold: exactly 2 false positives** (0x558e and 0xf008). All others stay below 15c during their one-legged window.

### Finding 8: Grace Period Eliminates One False Positive

- **0x558e** has a 61s window — a **60s grace period** means monitoring barely starts before the second side fills. False positive eliminated.
- **0xf008** has a 107s window — still exposed even with 60s grace (the filled YES side drops 15c by 60s after placement, which is when monitoring begins).

### Projected P&L Comparison

| Scenario | Successes | False Positives | One-Legged Losses | Net P&L |
|---|---|---|---|---|
| **Baseline (200s timer)** | 26 × $1.00 = +$26.00 | 0 | 5 × -$10.64 avg = -$53.20 | **-$27.20** |
| **15c + 60s grace** | 25 × $1.00 = +$25.00 | 1 × -$4.00 | 5 × -$3.00 avg = -$15.00 | **+$6.00** |
| **15c + 30s grace** | 24 × $1.00 = +$24.00 | 2 × -$4.00 | 5 × -$3.00 avg = -$15.00 | **+$1.00** |
| **10c + 60s grace** | 24 × $1.00 = +$24.00 | 2 × -$3.00 | 5 × -$2.00 = -$10.00 | **+$8.00** |

All scenarios improve on the -$27.20 baseline by $28-$35. The strategy goes from net negative to net positive.

### Recommended Parameters (Data-Driven)

Based on the full analysis:

```
stopLossMaxDropCents: 15        // catches all 5 failures, only 1 FP with 60s grace
stopLossGracePeriodMs: 60000    // eliminates 0x558e FP (61s window)
stopLossMinTimeRemainingMs: 60000  // hard cutoff before market resolution
stopLossTimeoutMs: 200000       // keep existing fallback as safety net
```

The key insight is that **the one-legged condition (`yesHoldings > 0 XOR noHoldings > 0`) is the primary filter**, and the price drop is a secondary trigger within that filter. Since successful straddles almost always have partial fills on both sides within the grace period, the false positive rate is dramatically lower than the raw price-drop overlap would suggest.

## Open Questions

1. What are the exact resolution rules for 5-minute BTC up/down markets? (Needed for Binance feed option)
2. What does the `sellMarketPosition` call actually execute at? Can we get the fill price from the execution service?
3. Is the 0x65f4 orphaned straddle a known issue or a new bug?
4. Should we reduce `targetPositionSize` (currently 20) to limit per-trade risk while we tune the stop loss?
5. Would reducing `maxTimeRemainingMs` from 4:30 to (say) 3:00 help, by ensuring more time for both legs to fill before the market moves decisively?
6. **How long is the one-legged window for successful straddles?** (query provided above) This is the most important missing data point for calibrating the price-drop threshold.
