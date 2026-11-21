# trading-bot

Trades the `PREMARKET_BOX_BREAKOUT` strategy from `@projects/trading-core` on an **Alpaca paper account**, as a forward test of research H17/H18. It refuses to start with a live key (paper keys start with `PK`) or any base URL but `https://paper-api.alpaca.markets`.

The strategy engine never talks to the broker. This app hosts it: it feeds bars and quotes in, places the orders the engine asks for, reports fills back, and writes everything to the `trading` schema in universe-db.

## Run it locally

```sh
nx setup environment                 # writes .env.local (Alpaca keys from projects/trading/common, DB from platform/postgres)
nx docker postgres-utils             # local universe-db, if you don't point at the shared one
nx migrate:run postgres-utils        # creates the trading schema (migration 0006_trading_bot)
LOG_JSON=false nx serve trading-bot
```

`GET /api/status` shows the run id, today's positions, entry blockers and bar-feed health. `/api/health` and `/api/version` are as in the other services.

## Market data: use SIP and OPRA

The backtest used SIP 1-minute bars and Theta Data NBBO quotes. Running on anything else tests a different strategy.

- **Stock bars.** Alpaca's free plan streams IEX only; recent SIP data returns 403. Over the 40 trading days to 2026-11-13, IEX had 9 of the 30 box minutes on average (none on 3 days). Its box was narrower by $0.75 on average, and its first breakout differed on 9 of 40 days (2 in the opposite direction). Set `STOCK_FEED=sip` once the data plan is paid for. `iex` is allowed for plumbing tests, and every row records the feed it came from.
- **Option quotes.** The free feed is `indicative`; `opra` returns 403 until the OPRA agreement is signed on a plan that includes it. None of this preset's exits use the option price, so the feed doesn't change decisions. It does change the limit prices and the slippage measured against the engine's `refPrice`. The `trades.nbbo` column exists so that indicative-feed runs can be re-measured later against Theta Data's NBBO.
- **Theta Data** (the Option Data tier) has option NBBO but no stock data: its stock endpoints answer "requires a value subscription".

## A trading day

1. **08:30 New York (`PREPARE_AT`).** A new engine and host for the day:
   - **Account rules:** reads the account's options level and pattern-day-trader fields (`src/host/account-rules.ts`). It refuses entries rather than work around them. Every trade here opens and closes the same day, so each is a day trade; a margin account under $25k gets 3 in 5 business days.
   - **Warmup:** 15 trading days of 04:00–20:00 bars, plus today's bars so far.
   - **Reconciliation:** compares what the broker holds with what the bot saved.
   - **Streams:** connects the bar and trade-update streams.
2. **09:30–10:30.** The engine signals on the box break. The entry is a limit order at the ask plus `ENTRY_CUSHION`. Whatever hasn't filled after `ENTRY_TIMEOUT_MS` is canceled; a partial fill opens a smaller position.
3. **Exits fire on QQQ's 1-minute bars.** The bot sells with a limit at the bid, steps down a tick every `EXIT_STEP_MS`, then sends a market order. Fills from every order in the chain are added up and reported to the engine as one cumulative update under the intent's id. That's the engine's contract: it ignores partials until the final status.
4. **15:55, or 5 minutes before an early close.** The strategy goes flat. As a backstop, the host sells anything still held 2 minutes before the close.
5. **20:00 (`END_AT`).** Streams close and the day record is final.

## Robustness

- **Streams:** both reconnect with backoff.
- **Bar feed:** keeps bars in order, drops repeats, and fills any gap from REST before the bar that revealed it.
- **Stale data:** the watchdog backfills and reconnects when bars stop (2.5 minutes in regular hours, 20 minutes outside them). If bars stop for 5 minutes while holding during regular hours, it flattens.
- **After a restart** (`src/host/reconcile.ts`):
  - **Orders:** the bot's leftover orders (client ids start with `tb-`) are canceled.
  - **Positions it saved:** a held contract the bot saved rejoins the engine through `TradingEngine.restorePosition`, with its original box levels. The broker's quantity and average price win. If the stop or target was hit while the bot was down, it's sold instead.
  - **Anything else:** a QQQ option it can't explain is sold. Anything else (stock, other underlyings, shorts, orders it didn't send) is left alone and logged as an incident.
- **Drift check:** every 5 minutes in regular hours, the broker's holdings are compared with the engine's. Extra contracts are sold.
- **Kill switch: stop the process.** SIGTERM runs Nest's `onModuleDestroy`, which:
  - cancels entries;
  - sells every position at market (`TradingEngine.closeAll`, reason `forced`);
  - writes the record, then exits.

  Give it longer than `SHUTDOWN_FLATTEN_TIMEOUT_MS` (60s), e.g. `terminationGracePeriodSeconds: 120`. Outside regular hours options can't trade, so positions are left for the next run to reconcile. A rollout or restart also flattens; a crash (SIGKILL, OOM) doesn't, and reconciliation picks those up.

## The forward-test record

Everything goes to the `trading` schema (`platform/postgres/db/src/schemas/trading.ts`), kept raw so a day can be replayed, compared with the backtest, or used to try changes later:

| table | what |
|---|---|
| `runs` | One process lifetime: version, feeds, full strategy config and host settings. |
| `bars` | Every 1-minute bar fed to the engine, with its feed, source (`stream`, `backfill`, `warmup`) and any later correction. |
| `engine_events` | Every engine event, including each 5-minute bar snapshot with the box and EMA values. |
| `chain_snapshots` | The option chain at each decision, with the quote time of every contract. |
| `option_quotes` | Quotes for held contracts, as polled. |
| `broker_orders` | Each order sent, with the quote at submission and its final state. One engine intent can take several. |
| `trade_updates` | Alpaca's trade-update stream, verbatim. |
| `positions` | Positions as last saved, used by restarts. |
| `trades` | Round trips: fills against the engine's reference prices (slippage), P&L, estimated fees. |
| `days` | One row per day: each signal and what came of it, the trades, net P&L, data health per run, and the account snapshot. |
| `incidents` | Restores, flattens, stale data, reconnects, blocked entries, failed exits. |

What to compare it with: `backtest run --config configs/premarket-box-qqq.json` (fills at the real quote, $0.05 a contract a side):

| sample | trades | net $ per trade | sd | standard error |
|---|---|---|---|---|
| dev 2024-02 → 2026-04 | 296 | +19.03 | 178 | 10.4 |
| holdout 2026-05 → 2026-11 | 68 | +59.11 | 356 | 43.2 |

**What the paper run can and can't show.** About 130 trades a year at a standard deviation near $180 means a few months can't tell a +$19 edge from zero. Telling +$19 from zero at t = 2 takes roughly 350 trades, close to three years. What the paper run *can* measure quickly:

- **Fills:** slippage against `refPrice`, and against the NBBO.
- **Feed parity:** whether the live box and decisions match what the backtest would have done on the same day (rerun `backtest run` over the paper dates once the data is downloaded).
- **Wiring:** whether anything in the plumbing goes wrong.

Paper fills are Alpaca's simulation, not a real exchange.

## Tests

```sh
nx test trading-bot
```

`src/replay/replay.spec.ts` drives the host through recorded days with fake Alpaca clients (`src/replay/fakes.ts`), and requires the same signals, skips, contracts, exit reasons, times and prices as `backtest run --config configs/premarket-box-qqq.json` on:

- **2025-11-24 → 12-02:** filter-blocked days, two stops (one on the 13:00 early close of 11-28), a 15:55 flat and a target;
- **2025-07-01 → 07-03:** blocked days, then an early-close flat at 12:55.

It also covers:

- **restarts:** a position restored mid-trade, a target hit while down, and an unexplained holding;
- **shutdown:** flattening;
- **account rules:** a pattern-day-trader block.

The fixture (`src/replay/fixtures/premarket-box-qqq.json.gz`) is built from the backtester's data directory, using the real CLI for the expectations:

```sh
nx run trading-bot:replay-fixture
```
