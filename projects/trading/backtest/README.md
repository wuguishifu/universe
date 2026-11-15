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

Options cover expirations 0–7 days out and whole-dollar strikes from 10 below the day's low to 10 above its high. Alpaca's option history starts in February 2024. For earlier years, add `--stocks-only` to fetch just the stock bars.

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

Each range is cut into chunks of about `chunkDays` trading days, and each chunk is pinned to one worker, so no worker holds more than its share of the data. Each chunk is backtested on its own after the usual warmup, and the chunks' totals are merged. Positions are always flat overnight, so this matches one continuous run; a full-history check matched to the cent.

Chunks never span a new year, so every config also gets a result per year, and multi-ticker strategies get one per ticker. Both are columns in `results.csv`; `results.jsonl` has each config's full breakdown for scripts like `research/tools/analyze.mjs`. If any config ends a day still holding a position, the sweep prints a warning: every strategy here should be flat overnight, so it usually means an exit couldn't fill.

Every result includes a t-stat: average P&L per trade divided by its standard error. An |t| under about 2 can't be told apart from luck, and after trying thousands of configs even the best training t means little. Trust the per-setting averages and the test column more than the #1 row. Out of thousands of configs, the best training result is mostly luck.

## How fills are modeled

- Alpaca has no historical option quotes, so each traded price is treated as the midpoint, with `spreadPct` of spread around it. Entries pay the ask, exits get the bid, then `slippagePct`, then rounding to the cent against you.
- Held options are replayed open → low → high → close each minute, so a stop and a target inside the same bar resolve as the stop.
- Entries and exits decided at a bar close fill on the first replayed print at or after the decision. Exits that fire on an option price (`pnlStop`, `profitTarget`, `trailingStop`) fill on the print after the one that triggered them, and never better than it, since an order sent in reaction can't trade on the print that triggered it.
- If nothing trades when an expiring option's closing order goes out, it settles at intrinsic value from the underlying's last price, as expiry would.
- Fills round to the cent against you, so with the default $0.01 minimum spread a cheap option already pays a full cent each way.
- Chains only include contracts that traded in the last `maxPriceAgeMinutes`, priced from bars that had closed by the decision time.
- Open interest isn't in the data, so don't use `minOpenInterest` here. `maxSpreadPct` only compares against the modeled spread.

## Daily rotation

Monthly ETF rotation rules (fixed weights, trend, momentum) from `@projects/trading-core`'s `allocation` module, run side by side:

```sh
nx run trading-backtest:download-daily --from=2016-01-01 --to=2026-11-13 --tickers=SPY,EFA,IEF,BIL
nx run trading-backtest:daily --config=research/daily/01-rotation.json [--cost-bps=15]
```

Daily bars are split- and dividend-adjusted and stored at `data/daily/<TICKER>.json`. `--adjustment=raw` stores bars as traded in `data/daily-raw/` instead. `--tickers-file` reads tickers from a file (whitespace or comma separated), and `--skip-existing` resumes a long download. Requests batch 100 tickers, and a ticker with no bars is saved as an empty file. Each download replaces the file, since adjusted prices change with every dividend. Their open and close are the official opening and closing prints.

A suite file has `from`, `to`, `costBps`, a `cash` ticker and `strategies`, a map from label to rule. Weights are decided on each month-end close and filled at the next open with fractional shares, and cost is charged in basis points of the value traded. Sharpe ratios are in excess of the cash ticker. Each run writes `runs/<time>-daily-<name>-<cost>bp/` with `summary.json`, `equity.csv` and `rebalances.csv`.
