# Iridium Straddle Bot - Investigation Notes

## Context

20-hour production test (Feb 11 10:43 PM - Feb 12 ~6:38 PM PST) resulted in -$15.98 P&L. The bot was overall stable/profitable except for two sharp drops at ~1-2 AM and ~8-10 AM PST.

### Test Configuration
- `targetEntry`: 0.95
- `targetPositionSize`: 10 shares
- `maxAskDistance`: 0.02 (fill gap cap)
- `minRegressionDataPoints`: 20
- `enableVerboseEvents`: true (debug events available with `debug-` prefix)
- All filters enabled (time, skew, stability, linear regression, OBI, toxic flow)

### Key Event Names
- `straddle-placed`, `straddle-fill`, `straddle-complete`, `straddle-place-failed`
- `straddle-reconcile-drift`
- `merge_service-merge-success`, `merge_service-merge-failed`
- `relayer_service-merge_positions-started/finished/failed`
- `skew-adjustment`, `skew-adjustment-failed`
- `execution_service-limit_order-place-started/finished/failed`
- `execution_service-order-cancel-started/finished`
- `execution_service-panic_sell-*`
- `ledger-drift`, `ledger-insufficient-funds`, `ledger-sync-error`
- Debug: `debug-filter-reject`, `debug-filter-pass-all`, `debug-book-update`
- Debug: `debug-linreg-eval`, `debug-obi-eval`, `debug-toxic-flow-eval`

### Key Tables
- `osmium.events` - all tracking events with JSONB `metadata` column
- Expression index on `(metadata->>'conditionId')` for fast filtering

---

## Discoveries

### 1. Overall Results
- 80 straddles placed over 20 hours (~4/hour)
- 71 both-filled (successful), 9 one-legged (losers)
- ~75 successful merges
- Zero `straddle-complete` events (straddles never fully clean up)
- Zero panic sells

### 2. Root Cause of Losses
The -$15.98 came from **one-legged fills** where one side filled instantly and the other never filled:

**8 AM block (4 straddles, ~$13.70 loss):**
- All placed at 08:05 with YES=0.38, NO=0.57
- YES filled 10 shares instantly on all 4
- NO never filled on any of them
- Skew bumped NO from 0.57 to 0.58 (one adjustment each), then nothing
- Markets crashed: YES price went from 0.38 to 0.02-0.05 within 30 minutes

**1 AM block (2 straddles, ~$10.80 loss at 30 min):**
- `0xb718dbcd`: NO filled 10, YES=0 (never filled)
- `0xc57b283a`: NO filled 10, YES=0 (never filled)
- NO price crashed from 0.57 to 0.01-0.05 within 30 minutes

### 3. Fill Gap Distribution
For the 71 both-filled straddles:
- Min: 0.0 min, Median: 0.9 min, P75: 4.0 min, P90: 10.8 min, P95: 16.7 min, Max: 26.8 min
- 47/71 (66%) fill within 2 min
- 56/71 (79%) fill within 5 min
- 71/71 (100%) fill within 30 min

### 4. Time-Based Timeout: REJECTED
- 2 min timeout: kills 24/71 good straddles (34%)
- 5 min timeout: kills 15/71 good straddles (21%)
- 30 min timeout: kills 0 good straddles BUT prices already crashed by then
- At 30 min mark, the one-legged positions were worth $0.01-0.05 (vs $0.38-0.57 entry)

### 5. Price-Based Stop-Loss: REJECTED
Good straddles regularly see 50-80% drawdowns during the fill gap:
- `0xfcd72f` (both filled, 26.8 min gap): bought YES at 0.57, dropped to 0.09 (-84%)
- `0x5aaf50` (both filled, 23.1 min gap): bought YES at 0.38, dropped to 0.07 (-82%)
- No clean threshold separates good straddles (temporary crash, recovers) from bad ones (permanent crash)

### 6. Entry Cost Drift Fix (IMPLEMENTED)
Added total cost ceiling check in `calculateEntryPlan` (alpha.service.ts Step E):
- After fill gap cap and rounding, reject if `targetYes + targetNo > targetEntry`
- Prevents fill gap cap from pushing entry cost above 0.95
- Markets with wide spreads (where fill gap cap causes drift) get rejected

### 7. Filter Analysis
- **Time filter**: Working correctly. Holds markets until 5-55 min window, doesn't block viable entries.
- **Skew filter**: Working correctly. Blocks one-sided markets (<$0.15 on one side) that can't straddle.
- Other filters (stability, linreg, OBI, toxic flow) not yet analyzed for this test.

---

## Open Investigations

### Investigation #1: Correlation / Concentration Risk
**Question:** Were the 4 markets at 8 AM (and 2 at 1 AM) correlated? Did they all crash because of the same event/news?

**Why it matters:** If all 4 were the same type of market or responded to the same catalyst, limiting max concurrent straddles per "cluster" or direction would cap losses. The 8 AM loss would have been ~$3.40 instead of ~$13.70 with a 1-straddle limit.

**What to look at:**
- Are the condition IDs related (same event, same category)?
- Did all 4 markets move in the same direction at the same time?
- Were there other markets at that time that did NOT crash?
- Could we detect correlation at entry time from the book data?

**Findings:**
- All 4 markets at 8 AM were BTC/ETH/SOL/XRP "Up or Down" for the SAME hour (11 AM ET)
- All 4 markets at 1 AM were BTC/ETH/SOL/XRP "Up or Down" for 4 AM ET
- They moved in perfect lockstep — all crashed from YES ~0.52 to YES ~0.10 within 10 minutes
- The bot is ONLY running crypto markets (crypto.adapter.ts), so every batch is 4 correlated assets
- This is 4x leverage on the same underlying bet, not diversification
- Discovery service provides `asset` and `eventStartTime` fields that can be used to deduplicate

**Recommended fix:** Limit to 1 straddle per `eventStartTime` (or per hour). Pick the best of 4 based on spread/OBI/liquidity. This reduces bad-hour losses from ~$14 to ~$3.50.

**Longer-term fix:** Diversify into non-crypto markets (politics, sports, weather) for uncorrelated exposure.

### Investigation #2: Entry-Time Signals — NO ACTIONABLE SIGNAL FOUND
**Question:** Was there anything detectable at entry time that distinguished the 8 AM markets from successful ones?

**Why it matters:** If we can identify pre-crash signals, we can add a filter to prevent entering those markets.

**Findings:**

**Aggregate comparison (one-legged vs both-filled at entry):**
- Volume: One-legged had HIGHER avg min-side volume (39K vs 28K) — no signal
- Spread: Nearly identical (0.018 vs 0.015 total spread) — no signal
- Entry cost: Both 0.95 — no signal
- Market spread (yes+no): 0.9911 vs 0.9922 — no signal

**Individual entry conditions:**
- All 9 one-legged straddles had standard parameters: $0.01 bid spreads, $0.95 entry cost, ~54 min remaining
- Indistinguishable from the 71 both-filled straddles with identical numbers
- Volumes varied widely across both groups with no separating threshold

**First fill speed (most promising, still not viable):**
- One-legged median: 4.9s vs both-filled median: 17.0s
- One-legged had 2/9 fills under 2s vs 2/72 for good straddles
- BUT ranges overlap heavily (one-legged max was 210.8s, many good straddles fill in <5s)
- A fast-fill filter would kill too many good straddles for marginal benefit

**Conclusion:** One-legged straddles were not individually detectable at entry time. They lost money because they were all correlated crypto markets that crashed together. The concentration limit (Investigation #1) is the correct fix — cap damage per correlated group rather than try to predict which individual straddle will fail.

---

## Code Changes Made This Session
1. **alpha.service.ts**: Added Step E total cost ceiling (`targetYes + targetNo > targetEntry` → reject)
2. **alpha.service.ts**: Added `Total` to entry plan reason string
3. **environment-schema.ts** (user changes): `targetEntry` default changed to 0.95, `maxAskDistance` to 0.02, `minRegressionDataPoints` to 20, moved `mergeIntervalMs` up
