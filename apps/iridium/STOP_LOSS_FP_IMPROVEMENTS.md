# Stop Loss: False Positive Improvements #2 and #3

**Last updated:** 2026-02-18
**Purpose:** Context for future agents implementing the next two stop loss FP reduction improvements. Improvement #1 (velocity divergence gate) is already implemented.

---

## Background

Data analysis confirmed ~4 of 13 `price_drop` stop-losses were false positives: BTC temporarily spiked against the filled leg then reversed, and holding would have been significantly more profitable. Improvement #1 (velocity divergence gate) addresses the clearest pattern. Improvements #2 and #3 are more involved and are documented here.

---

## Improvement #2 — Confirmation Delay

### Problem

The `price_drop` trigger fires immediately when the condition is first met. In the "flat → spike → reversal" pattern, the condition is met for only one or two ticks before the price recovers. A short confirmation delay would have avoided these exits entirely.

**Affected false-positive conditionIds:** 0xbc8dc8, 0x62072e, 0x208d78

### Design

When the `price_drop` condition is first met, start a 10–15 second confirmation timer instead of immediately calling `handleStopLoss`. If the condition is still met when the timer fires, execute the stop loss. If price recovers (condition is no longer met on the next tick), cancel the timer.

### Implementation

**1. Add `pendingConfirmationTimer` to `StopLossState` in `straddle-manager.service.ts`:**

```typescript
type StopLossState = {
  subscription: Subscription | null;
  fallbackTimer: NodeJS.Timeout | null;
  pendingConfirmationTimer: NodeJS.Timeout | null;  // NEW
  triggered: boolean;
};
```

Initialize to `null` alongside the other fields in `startStopLossMonitor()`.

**2. Add `stopLossConfirmationDelayMs: number | null` to `StopLossConfig`:**

```typescript
export type StopLossConfig = {
  timeoutMs: number | null;
  maxDropCents: number | null;
  gracePeriodMs: number | null;
  minTimeRemainingMs: number | null;
  confirmationDelayMs: number | null;  // NEW — null = disabled (current behavior)
};
```

Set in `Crypto5mAdapter`: `stopLossConfirmationDelayMs: 12_000` (12 seconds; tune from data).

**3. Replace the `price_drop` handler body in the tick subscription:**

```typescript
// Price drop check
if (config.maxDropCents && (entryPrice - currentBid) * 100 >= config.maxDropCents) {
  if (config.confirmationDelayMs) {
    // Condition is met — start confirmation timer if not already pending
    if (!state.pendingConfirmationTimer) {
      state.pendingConfirmationTimer = setTimeout(() => {
        state.pendingConfirmationTimer = null;
        this.handleStopLoss(conditionId, 'price_drop');
      }, config.confirmationDelayMs);
    }
    return;
  }
  this.handleStopLoss(conditionId, 'price_drop');
  return;
} else {
  // Condition no longer met — cancel pending timer
  if (state.pendingConfirmationTimer) {
    clearTimeout(state.pendingConfirmationTimer);
    state.pendingConfirmationTimer = null;
  }
}
```

**4. Clear `pendingConfirmationTimer` in `cleanupStraddle()`** alongside `fallbackTimer`.

### Risk

If BTC drops fast and stays down, the confirmation delay costs 10–15 seconds of worse exit price. Mitigated by the velocity gate (#1) — if velocity is adverse at trigger time, the drop is likely real; the confirmation timer adds an additional 12s buffer before acting, during which price can continue falling. Net: only use this in combination with #1.

---

## Improvement #3 — 5-Minute Candle Open as BTC Reference Price

### Problem

`btcPriceAtEntry` records the BTC price when the straddle was *placed*, which may be partway through a 5-minute candle. Polymarket's BTC 5-minute markets resolve based on the candle open vs candle close. Our BTC reference is therefore misaligned with market resolution logic, causing false positives when BTC moves in the unfavorable direction from placement but is still in the same favorable direction from candle open.

### Design

Subscribe to the Binance kline stream (`btcusdt@kline_5m`) to capture the open price of the current 5-minute candle. Record that value on the straddle at placement time. Use it (instead of `btcPriceAtEntry`) for all directed delta calculations in the monitor and in the velocity gate.

### Implementation

**1. Add kline stream to `BinancePriceService`:**

Subscribe to `wss://stream.binance.com:9443/ws/btcusdt@kline_5m` alongside the existing trade tick stream. On each kline event, expose the current candle's open price via a new method:

```typescript
// In BinancePriceService:
private currentCandleOpenPrice: number | null = null;

public getCandleOpen(): number | null {
  return this.currentCandleOpenPrice;
}
```

Update `currentCandleOpenPrice` on every kline tick from the `k.o` field.

**2. Add `btcCandleOpenAtEntry: number | null` to `ActiveStraddle` in `position.service.ts`:**

```typescript
type ActiveStraddle = {
  // ... existing fields ...
  btcPriceAtEntry: number | null;
  btcCandleOpenAtEntry: number | null;  // NEW
  // ...
};
```

**3. Record candle open at straddle placement in `placeStraddle()`:**

```typescript
const btcSnapshot = this.binancePriceService.getSnapshot();
const btcPriceAtEntry = btcSnapshot.currentPrice;
const btcCandleOpenAtEntry = this.binancePriceService.getCandleOpen();  // NEW

this.positionService.addStraddle({
  // ...
  btcPriceAtEntry,
  btcCandleOpenAtEntry,  // NEW
  // ...
});
```

Also emit `btcCandleOpenAtEntry` in the `straddle-placed` Osmium event for analysis.

**4. Use `btcCandleOpenAtEntry` in the tick monitor and velocity gate:**

In the debug tracking event and in the velocity gate, replace references to `straddle.btcPriceAtEntry` with `straddle.btcCandleOpenAtEntry ?? straddle.btcPriceAtEntry` (fall back to `btcPriceAtEntry` if candle open is unavailable).

```typescript
const btcReference = straddle.btcCandleOpenAtEntry ?? straddle.btcPriceAtEntry;
const btcDelta = btcSnapshot.currentPrice != null && btcReference != null
  ? btcSnapshot.currentPrice - btcReference
  : null;
```

### Open Question

Confirm Polymarket's exact BTC resolution price source. Options:
- Binance spot close price at candle boundary
- TWAP over some window at expiry
- Pyth oracle at exact resolution timestamp

This affects whether the candle open alignment is the correct reference or whether a different benchmark should be used. Check Polymarket docs / resolver contract before finalizing.

---

## Related Docs

- `STOP_LOSS_CONTEXT.md` — Architecture overview, current stop loss logic, performance history
- `STOP_LOSS_INVESTIGATION.md` — Original problem analysis, proposed options A–E, threshold economics
- `PENDING_IMPROVEMENTS.md` — What was implemented in the 2026-02-14 commit + BTC trigger next steps
