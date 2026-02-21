# Stop Loss: Architecture & Current State

**Last updated:** 2026-02-18
**Purpose:** Context doc for future agents working on the iridium trading bot stop loss system.

---

## Quick Summary

Iridium runs a **straddle strategy** on Polymarket 5-minute BTC up/down markets — placing simultaneous limit orders on YES and NO. When one leg fills but the other doesn't, the position becomes a **one-legged straddle** that bleeds to $0 at resolution. The stop loss system detects this state and exits before catastrophic loss.

The current implementation uses a **multi-trigger tick-based monitor** (price drop + time remaining + fallback timer). A **BTC price-based trigger** is calibrated and ready to implement (see Pending Improvements below).

---

## Architecture

### Core Files

| File | Role |
|------|------|
| `src/modules/strategy/components/straddle-manager.service.ts` | **Central stop loss logic** — placement, monitoring, execution, cleanup |
| `src/modules/strategy/strategy.service.ts` | Orchestrates entry pipeline; passes stop loss config into `StraddleManagerService` |
| `src/modules/strategy/components/alpha.service.ts` | Entry signal filters (OBI, depth, time, regression, etc.) |
| `src/modules/execution/execution.service.ts` | Order placement, cancellation, market sells |
| `src/modules/clob/ws/market-ws.service.ts` | Real-time Polymarket order book + trade event streaming |
| `src/modules/binance/binance-price.service.ts` | Binance BTC/USDT price feed (rolling 60s window) |
| `src/modules/market-adapter/crypto-5m.adapter.ts` | 5-minute market config including stop loss parameters |
| `src/modules/position/position.service.ts` | In-memory tracking of active straddles |
| `src/environment/environment-schema.ts` | Config schema with stop loss parameter definitions |

### Data Flow

```
AlphaService.analyzeTick()
  → Entry signal passes all filters
  → StrategyService.execute(plan)
    → Debit capital from ledger
    → StraddleManagerService.placeStraddle(plan, stopLossConfig)
      → ExecutionService.placeLimitOrder() [YES first, then NO]
      → startStopLossMonitor(conditionId, config)
        ├── fallbackTimer (setTimeout, 200s)
        └── tick subscription (marketTicks$ filtered to conditionId)
              → on each tick, if one-legged:
                  ├── price_drop check (15c drop from entry)
                  ├── time_remaining check (<45s left)
                  └── → handleStopLoss(trigger)
```

### `ActiveStraddle` State Object

```typescript
type ActiveStraddle = {
  conditionId: string;
  yesOrderId: string;
  noOrderId: string;
  yesPrice: number;           // limit price for YES leg
  noPrice: number;            // limit price for NO leg
  quantity: number;           // target shares (e.g., 20)
  yesHoldings: number;        // current YES shares held
  noHoldings: number;         // current NO shares held
  yesCumulativeFilled: number;
  noCumulativeFilled: number;
  yesStatus: 'OPEN' | 'FILLED' | 'CANCELED';
  noStatus: 'OPEN' | 'FILLED' | 'CANCELED';
  placedAt: number;
  btcPriceAtEntry: number | null;
  skewInProgress: boolean;
  skewApplied: boolean;
};
```

---

## Current Stop Loss Logic

### One-Legged Detection

```typescript
const yesFilled = straddle.yesHoldings > 0;
const noFilled = straddle.noHoldings > 0;
if (yesFilled === noFilled) return; // both or neither → healthy, skip
// exactly one side has holdings → one-legged
```

### Trigger Conditions (evaluated on every Polymarket tick)

1. **Price drop** — filled side's best bid drops ≥15 cents from entry price
   `(entryPrice - currentBid) * 100 >= stopLossMaxDropCents`

2. **Time remaining** — market has ≤45 seconds left and position is one-legged
   `tick.timeRemaining <= stopLossMinTimeRemainingMs`

3. **Fallback timer** — 200 seconds after straddle placement (safety net, fires regardless of market state)

### Grace Period

Monitoring doesn't start until 30 seconds after placement (`stopLossGracePeriodMs = 30_000`). This eliminates false positives — successful straddles typically have both sides partially filled within seconds; the grace period lets normal fill dynamics play out before any one-legged condition is acted on.

### Stop Loss Execution Sequence

```
handleStopLoss(conditionId, trigger):
  1. Guard: if state.triggered → return (prevent double execution)
  2. Guard: if minSide >= quantity * 0.99 → return (both sides filled, not one-legged)
  3. Guard: if yesFilled === noFilled → return (not one-legged)
  4. Cancel the unfilled side's order (if still OPEN)
  5. Capture exit price (best bid of filled side)
  6. Market-sell filled holdings at panic price of $0.01 (GTC, fills with best bidder)
  7. Capture BTC snapshot for analysis
  8. Emit 'straddle-stop-loss' event to Osmium
  9. cleanupStraddle()
```

### Cleanup

- Records completion timestamp in `recentlyCompleted` map (enforces 5-minute cooldown)
- Clears fallback timer
- Unsubscribes from tick monitor
- Removes from all tracking maps (`stopLossState`, `positionService`, `orderMap`)
- Resets alpha service state for the conditionId

---

## Configuration (Crypto5mAdapter)

```typescript
stopLossTimeoutMs = 200_000;        // 200s fallback
stopLossMaxDropCents = 15;          // 15 cent price drop trigger
stopLossGracePeriodMs = 30_000;     // 30s before monitoring starts
stopLossMinTimeRemainingMs = 45_000; // exit if <45s to resolution and one-legged
straddleCooldownMs = 300_000;       // 5-min cooldown after completion
```

> **Note:** The 1-hour market adapter (`Crypto1hAdapter`) has all stop loss features disabled (`null`) because fill gaps can extend up to 27 minutes.

---

## Performance History

### Initial Baseline (2026-02-14, 33 straddles, 200s timer only)

| Outcome | Count | P&L |
|---------|-------|-----|
| Both legs filled | ~18 (55%) | +$1.00 each |
| Near-complete (tiny residual) | 8 (24%) | +$1.00 each |
| True one-legged losses | 5 (15%) | -$7.60 to -$11.40 each |
| **Net P&L** | | **-$27.20** |

Root cause: The 200s timer fires after market resolution for any straddle entered with <3:20 remaining.

### Overnight Test (2026-02-14, 74 straddles, multi-trigger implemented)

- 16 true one-legged losses at avg $2.24 each (vs $10.64 avg before)
- All 16 triggered via `price_drop`, firing at avg ~65s elapsed
- Exit prices ranged $0.02–$0.38 (avg $0.22)
- Losses reduced ~79% per trade vs baseline
- Remaining problem: price_drop trigger is a **lagging indicator** (Polymarket book lags BTC)

---

## Pending: BTC Price-Based Stop Loss Trigger

**Status:** Calibration data collected, implementation design complete, not yet coded.

### Motivation

The 15-cent Polymarket book drop is a lagging signal — the BTC price moves first, then the order book adjusts. With 30s grace + 15c trigger, losses still average $2.24 per one-legged trade at avg $0.22 exit price.

### Validated Architecture

From overnight data analysis:
- Successful straddle one-legged windows: median 5s, max 85s — BTC cannot move $25+ in 5s
- All 16 failures showed large BTC deltas at time of stop loss
- **Threshold:** `|btcCurrent - btcAtEntry| >= $25–$30` cleanly separates failures from successes
- **No grace period needed** — BTC signal is clean, not noisy like order book

### Implementation Plan

1. Add `btcStopLossThresholdDollars: number | null` to `MarketAdapter` interface and `Crypto5mAdapter`
2. In `startStopLossMonitor()`, subscribe to `binanceWsService.ticks$` alongside existing Polymarket tick subscription
3. On each Binance tick for an active straddle:
   - Check one-legged condition
   - If `|btcCurrent - btcAtEntry| >= btcStopLossThresholdDollars` → call `handleStopLoss(conditionId, 'btc_price')`
4. Add `'btc_price'` as a trigger type in `handleStopLoss()`
5. Set initial threshold at $25 (conservative), calibrate from next test run

### Data Source

`BinancePriceService` (already implemented) maintains a 60s rolling window of BTC prices and exposes:
- `getSnapshot()` — current price, velocity, acceleration
- `ticks$` — real-time tick stream from Binance WebSocket

`btcPriceAtEntry` is already recorded on every straddle in `ActiveStraddle`.

### Debug Data

`straddle-btc-monitor` events are already being emitted on every one-legged tick (added in 2026-02-14 commit). Query Osmium for these to calibrate the threshold before implementing.

```sql
SELECT
  metadata->>'conditionId' AS cid,
  metadata->>'btcPriceAtEntry' AS btc_entry,
  metadata->>'btcCurrentPrice' AS btc_current,
  (metadata->>'btcCurrentPrice')::float - (metadata->>'btcPriceAtEntry')::float AS btc_delta,
  metadata->>'filledSide' AS filled_side,
  metadata->>'timeElapsed' AS time_elapsed
FROM osmium.events
WHERE name = 'debug-straddle-btc-monitor'
  AND source = 'iridium'
ORDER BY created_at DESC
LIMIT 500;
```

---

## Open Questions

1. **BTC threshold calibration** — Need next test run data from `debug-straddle-btc-monitor` events to validate $25–$30 range empirically.
2. **Ghost straddles** — 47 of 74 straddles in the overnight test had no fills or no completion event. Investigate whether WebSocket disconnection is causing missed order updates.
3. **0x65f4 orphan** — One straddle (YES filled 20, NO unfilled) had no stop loss event in the initial test. Investigate whether the fallback timer can be lost during WebSocket reconnection.
4. **Position sizing** — Should `targetPositionSize` be reduced from 20 shares while stop loss is still being tuned? Reduces per-trade risk.
5. **Entry window** — Would reducing `maxTimeRemainingMs` from 4:30 to 3:00 reduce one-legged frequency by ensuring more time for both legs to fill?

---

## Key Event Types (Osmium)

| Event Name | When Emitted | Key Fields |
|------------|-------------|------------|
| `straddle-placed` | On entry | conditionId, yesPrice, noPrice, quantity, btcPriceAtEntry |
| `straddle-fill` | Each partial fill | conditionId, side, delta, holdings |
| `straddle-stop-loss` | On exit | conditionId, filledSide, holdings, trigger, exitPrice, btcDelta |
| `straddle-complete` | After cleanup | conditionId, final state |
| `debug-straddle-btc-monitor` | Each one-legged tick | btcPriceAtEntry, btcCurrentPrice, btcDelta, btcVelocity, filledSide |
| `skew-adjustment` | Inventory skew applied | conditionId, side, newPrice |
| `straddle-place-failed` | Order rejection | conditionId, error |

---

## Osmium Queries

### Aggregate P&L

Stop-loss P&L is exact: `(exitPrice - filledSidePrice) × holdings` (unfilled leg is cancelled/refunded, so only the filled leg's cost basis applies). Straddles with no completion event are assumed to have succeeded (`quantity − capital`), giving an estimated upper-bound total.

> Note: `straddle-complete` is only emitted after stop-loss cleanup — successful straddles (both legs fill, market resolves) emit no completion event. "no_completion_event" rows include both true successes and ghost straddles.

```sql
WITH placed AS (
  SELECT
    metadata->>'conditionId'       AS condition_id,
    (metadata->>'capital')::float  AS capital,
    (metadata->>'quantity')::float AS quantity,
    (metadata->>'yesPrice')::float AS yes_price,
    (metadata->>'noPrice')::float  AS no_price,
    created_at                     AS placed_at
  FROM osmium.events
  WHERE name = 'straddle-placed'
    AND source = 'iridium'
),
stop_losses AS (
  SELECT
    metadata->>'conditionId'         AS condition_id,
    metadata->>'filledSide'          AS filled_side,
    (metadata->>'exitPrice')::float  AS exit_price,
    (metadata->>'holdings')::float   AS holdings,
    (metadata->>'yesPrice')::float   AS yes_price,
    (metadata->>'noPrice')::float    AS no_price,
    metadata->>'trigger'             AS trigger
  FROM osmium.events
  WHERE name = 'straddle-stop-loss'
    AND source = 'iridium'
),
classified AS (
  SELECT
    p.condition_id,
    p.capital,
    p.quantity,
    p.yes_price,
    p.no_price,
    p.placed_at,
    sl.filled_side,
    sl.exit_price,
    sl.holdings     AS sl_holdings,
    sl.trigger,
    CASE
      WHEN sl.condition_id IS NOT NULL THEN 'stop_loss'
      ELSE 'no_completion_event'
    END AS outcome,
    -- Exact P&L for stop-loss: recover exitPrice per share vs filled leg cost basis only
    CASE
      WHEN sl.condition_id IS NOT NULL THEN
        (sl.exit_price - CASE WHEN sl.filled_side = 'yes' THEN p.yes_price ELSE p.no_price END)
        * sl.holdings
      ELSE NULL
    END AS realized_pnl,
    -- Estimated P&L assuming no_completion_event straddles all succeeded
    CASE
      WHEN sl.condition_id IS NOT NULL THEN
        (sl.exit_price - CASE WHEN sl.filled_side = 'yes' THEN p.yes_price ELSE p.no_price END)
        * sl.holdings
      ELSE
        p.quantity - p.capital
    END AS estimated_pnl
  FROM placed p
  LEFT JOIN stop_losses sl ON sl.condition_id = p.condition_id
)
SELECT
  COALESCE(outcome, 'TOTAL')                AS outcome,
  COUNT(*)                                   AS straddles,
  ROUND(SUM(realized_pnl)::numeric,  4)     AS realized_pnl,
  ROUND(AVG(realized_pnl)::numeric,  4)     AS avg_realized_pnl,
  ROUND(MIN(realized_pnl)::numeric,  4)     AS worst_trade,
  ROUND(MAX(realized_pnl)::numeric,  4)     AS best_trade,
  ROUND(SUM(estimated_pnl)::numeric, 4)     AS estimated_total_pnl
FROM classified
GROUP BY GROUPING SETS ((outcome), ())
ORDER BY outcome NULLS LAST;
```

### Stop-Loss P&L by Trigger & Filled Side

```sql
WITH placed AS (
  SELECT
    metadata->>'conditionId'       AS condition_id,
    (metadata->>'yesPrice')::float AS yes_price,
    (metadata->>'noPrice')::float  AS no_price
  FROM osmium.events
  WHERE name = 'straddle-placed' AND source = 'iridium'
),
stop_losses AS (
  SELECT
    metadata->>'conditionId'        AS condition_id,
    metadata->>'filledSide'         AS filled_side,
    (metadata->>'exitPrice')::float AS exit_price,
    (metadata->>'holdings')::float  AS holdings,
    (metadata->>'yesPrice')::float  AS yes_price,
    (metadata->>'noPrice')::float   AS no_price,
    metadata->>'trigger'            AS trigger,
    (metadata->>'timeElapsed')::int AS time_elapsed_ms
  FROM osmium.events
  WHERE name = 'straddle-stop-loss' AND source = 'iridium'
)
SELECT
  sl.trigger,
  sl.filled_side,
  COUNT(*)                                                                  AS count,
  ROUND(AVG(sl.time_elapsed_ms / 1000.0)::numeric, 1)                      AS avg_elapsed_s,
  ROUND(AVG(sl.exit_price)::numeric, 4)                                     AS avg_exit_price,
  ROUND(AVG(
    CASE WHEN sl.filled_side = 'yes' THEN p.yes_price ELSE p.no_price END
  )::numeric, 4)                                                             AS avg_entry_price,
  ROUND(SUM(
    (sl.exit_price - CASE WHEN sl.filled_side = 'yes' THEN p.yes_price ELSE p.no_price END)
    * sl.holdings
  )::numeric, 4)                                                             AS total_pnl,
  ROUND(AVG(
    (sl.exit_price - CASE WHEN sl.filled_side = 'yes' THEN p.yes_price ELSE p.no_price END)
    * sl.holdings
  )::numeric, 4)                                                             AS avg_pnl
FROM stop_losses sl
JOIN placed p ON p.condition_id = sl.condition_id
GROUP BY sl.trigger, sl.filled_side
ORDER BY sl.trigger, sl.filled_side;
```

---

## Related Docs

- `STOP_LOSS_INVESTIGATION.md` — Original problem analysis, data queries, proposed options A–E, threshold economics
- `PENDING_IMPROVEMENTS.md` — What was implemented in the 2026-02-14 commit + BTC trigger next steps
