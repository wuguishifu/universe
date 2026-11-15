// Does Alpaca serve daily bars for companies that later delisted or changed ticker?
// usage: node --env-file-if-exists=.env.local --import @swc-node/register/esm-register research/tools/check-delisted.ts
import { AlpacaClient } from '../../src/download/alpaca-client';

const cases: Array<[string, string]> = [
  ['TWTR', 'taken private 2022-10-28'],
  ['ATVI', 'acquired 2023-10-13'],
  ['CELG', 'acquired 2019-11-20'],
  ['LNKD', 'acquired 2016-12-08'],
  ['BBBY', 'bankrupt, delisted 2023-05'],
  ['BBBYQ', 'BBBY on OTC after delisting'],
  ['SIVB', 'failed 2023-03-10'],
  ['FRC', 'failed 2023-05-01'],
  ['SHLD', 'bankrupt 2018-10'],
  ['EXPR', 'bankrupt 2024-04'],
  ['FB', 'renamed META 2022-06-09'],
  ['META', 'formerly FB'],
];

const client = AlpacaClient.fromEnv();
for (const [symbol, note] of cases) {
  try {
    const bars = await client.dailyBars(
      symbol,
      '2016-01-01T00:00:00Z',
      '2026-11-14T00:00:00Z',
    );
    const first = bars[0]?.t.slice(0, 10) ?? '-';
    const last = bars.at(-1)?.t.slice(0, 10) ?? '-';
    console.log(
      `${symbol.padEnd(6)} ${String(bars.length).padStart(5)} bars  ${first} → ${last}   (${note})`,
    );
  } catch (error) {
    console.log(
      `${symbol.padEnd(6)} error: ${String(error).slice(0, 120)}   (${note})`,
    );
  }
}
