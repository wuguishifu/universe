# trading-backtest

Replays historical Alpaca data through `@projects/trading-core` and reports how a strategy config would have done.

## Get data

Put `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY` in `projects/trading/backtest/.env` (paper keys work; set `APCA_API_BASE_URL` for live keys), then:

```sh
nx run trading-backtest:download --from=2026-08-03 --to=2026-11-13 --tickers=SPY
```

This writes `data/` (gitignored) and skips days already on disk, so it can be rerun to resume or extend. Layout:

```plaintext
data/calendar.json                    /v2/calendar days
data/stocks/<TICKER>/<DATE>.json      [AlpacaBar]                       1-minute SIP bars, 04:00–20:00
data/options/<TICKER>/<DATE>.json     { "<OCC symbol>": [AlpacaBar] }   1-minute bars that day
```

Options cover expirations 0–7 days out and whole-dollar strikes from 10 below the day's low to 10 above its high. Alpaca's option history starts in February 2024.

## Run

```sh
nx run trading-backtest:backtest --config=configs/ema-vwap-crossover.json --from=2026-08-03 --to=2026-11-13
```

Add `--daily` for a line per day. Each run prints a summary and writes `runs/<time>-<name>/` with `config.json` (enough to reproduce it), `summary.json`, `trades.csv`, `days.csv`, `equity.csv` and `events.jsonl`.

A config's `strategy` is either a full strategy config or `{ "preset": "ema-vwap-crossover" }` plus top-level fields to replace. See `configs/` for examples.

## Sweep

```sh
nx run trading-backtest:sweep --config=sweeps/ema-vwap-grid.json
```

A sweep file has a `base` strategy and `axes`. Each axis maps labels to patches, and every combination of one label per axis is run on the `train` range across worker threads. Patches merge into objects, and their `exits`, `entryFilters` and `risk` are appended to the base's, so each axis can add its own rule. Exits run in the order they end up in, which follows axis order.

It prints the average result for each label across every config that used it, then the top configs by training result with how they did on the `test` range. The test range is never used for ranking. Output goes to `runs/<time>-sweep-<name>/`: `results.csv` (every config), `marginals.csv`, and a `top-NN.json` per top config that `backtest run --config` accepts.

Trust the per-setting averages and the test column more than the #1 row. Out of thousands of configs, the best training result is mostly luck.

## How fills are modeled

- Alpaca has no historical option quotes, so each traded price is treated as the midpoint, with `spreadPct` of spread around it. Entries pay the ask, exits get the bid, then `slippagePct`, then rounding to the cent against you.
- Held options are replayed open → low → high → close each minute, so a stop and a target inside the same bar resolve as the stop.
- Chains only include contracts that traded in the last `maxPriceAgeMinutes`, priced from bars that had closed by the decision time.
- Open interest isn't in the data, so don't use `minOpenInterest` here. `maxSpreadPct` only compares against the modeled spread.
