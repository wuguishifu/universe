import { SimulationConfig } from './simulation-config';

export type ModeledQuote = { bid: number; ask: number; last: number };

/** Treats a traded price as the midpoint and puts the modeled spread around it. */
export function modelQuote(
  price: number,
  { spreadPct, minSpread }: Pick<SimulationConfig, 'spreadPct' | 'minSpread'>,
): ModeledQuote {
  const half = Math.max(minSpread, price * spreadPct) / 2;
  return { bid: Math.max(0, price - half), ask: price + half, last: price };
}

/** Option prices move in pennies. Round against the trader: buys up, sells down. */
export const roundToCent = (price: number, side: 'buy' | 'sell'): number => {
  const cents = price * 100;
  // The epsilon keeps 1.03 from becoming 1.04 when float error makes it 103.00000000000001.
  const rounded =
    side === 'buy' ? Math.ceil(cents - 1e-9) : Math.floor(cents + 1e-9);
  return Math.max(0, rounded) / 100;
};
